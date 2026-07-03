"""Decoupled product ingest engine — scrape, compress, brand analysis."""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from PIL import Image

from app.config import get_settings
from app.utils.security import SSRFError, validate_public_url

logger = logging.getLogger(__name__)

MAX_IMAGE_DIM = 768
USER_AGENT = "AdMatrixBot/1.0 (+https://admatrix.ai)"


class ProductIngestService:
    """Scrapes product pages, compresses images, and generates brand books via Qwen."""

    def __init__(self, qwen_api_key: str | None = None, qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"):
        self.qwen_api_key = qwen_api_key
        self.qwen_base_url = qwen_base_url.rstrip("/")

    async def scrape_and_clean_html(self, url: str) -> dict[str, Any]:
        """Fetch product page HTML and extract structured content."""
        validate_public_url(url)
        settings = get_settings()
        max_bytes = settings.max_scrape_bytes

        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            if int(response.headers.get("content-length", 0)) > max_bytes:
                raise ValueError(f"Response exceeds {max_bytes} byte limit")
            raw_bytes = response.content[:max_bytes]
            raw_html = raw_bytes.decode(response.encoding or "utf-8", errors="replace")

        soup = BeautifulSoup(raw_html, "html.parser")

        for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
            tag.decompose()

        title = (soup.title.string or "").strip() if soup.title else ""
        og_title = soup.find("meta", property="og:title")
        product_name = (og_title["content"] if og_title and og_title.get("content") else title) or None

        og_site = soup.find("meta", property="og:site_name")
        company_name = og_site["content"].strip() if og_site and og_site.get("content") else None

        text_blocks = [t.strip() for t in soup.stripped_strings if len(t.strip()) > 20]
        cleaned_text = "\n".join(text_blocks[:80])

        image_urls = self._extract_image_urls(soup, url)
        price_match = re.search(r"[\$€£¥]\s?[\d,.]+", cleaned_text)
        price = price_match.group(0) if price_match else None

        return {
            "source_url": url,
            "company_name": company_name,
            "product_name": product_name,
            "raw_html": raw_html[:500_000],
            "cleaned_text": cleaned_text,
            "image_urls": image_urls[:12],
            "price_hint": price,
        }

    def _extract_image_urls(self, soup: BeautifulSoup, base_url: str) -> list[str]:
        seen: set[str] = set()
        urls: list[str] = []

        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
            if not src or src.startswith("data:"):
                continue
            absolute = urljoin(base_url, src)
            if absolute not in seen and self._is_valid_image_url(absolute):
                seen.add(absolute)
                urls.append(absolute)

        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            absolute = urljoin(base_url, og_image["content"])
            if absolute not in seen:
                urls.insert(0, absolute)

        return urls

    @staticmethod
    def _is_valid_image_url(url: str) -> bool:
        path = urlparse(url).path.lower()
        return any(path.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")) or "image" in path

    async def prune_and_compress_images(self, image_urls: list[str]) -> list[dict[str, Any]]:
        """Download images, resize to 768×768 max, return base64 payloads."""
        results: list[dict[str, Any]] = []

        async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": USER_AGENT}) as client:
            tasks = [self._process_single_image(client, url, idx) for idx, url in enumerate(image_urls)]
            processed = await asyncio.gather(*tasks, return_exceptions=True)

        for item in processed:
            if isinstance(item, Exception):
                logger.warning("Image processing failed: %s", item)
                continue
            if item:
                results.append(item)

        return results

    async def _process_single_image(
        self, client: httpx.AsyncClient, url: str, index: int
    ) -> dict[str, Any] | None:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            img = Image.open(io.BytesIO(resp.content)).convert("RGB")
            img.thumbnail((MAX_IMAGE_DIM, MAX_IMAGE_DIM), Image.Resampling.LANCZOS)

            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=82, optimize=True)
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")

            return {
                "index": index,
                "source_url": url,
                "width": img.width,
                "height": img.height,
                "format": "jpeg",
                "base64": encoded,
                "size_bytes": len(buffer.getvalue()),
            }
        except Exception as exc:
            logger.debug("Skipping image %s: %s", url, exc)
            return None

    async def generate_brand_book(
        self,
        cleaned_text: str,
        image_assets: list[dict[str, Any]],
        company_name: str | None = None,
        product_name: str | None = None,
    ) -> dict[str, Any]:
        """Multimodal brand analysis via Qwen3.6-Plus."""
        if not self.qwen_api_key:
            return self._fallback_brand_book(cleaned_text, company_name, product_name)

        content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    "Analyze this product page and produce a brand book JSON with keys: "
                    "brand_voice, color_palette (hex list), typography_style, target_audience, "
                    "key_selling_points, cultural_notes, compliance_flags.\n\n"
                    f"Company: {company_name or 'Unknown'}\n"
                    f"Product: {product_name or 'Unknown'}\n\n"
                    f"Page text:\n{cleaned_text[:8000]}"
                ),
            }
        ]

        for asset in image_assets[:4]:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{asset['base64']}"},
                }
            )

        payload = {
            "model": "qwen-max",
            "messages": [{"role": "user", "content": content}],
            "response_format": {"type": "json_object"},
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.qwen_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.qwen_api_key}"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        import json

        raw_content = data["choices"][0]["message"]["content"]
        try:
            brand_book = json.loads(raw_content)
        except json.JSONDecodeError:
            brand_book = {"raw_analysis": raw_content}

        brand_book["model"] = "qwen-max"
        brand_book["image_count"] = len(image_assets)
        return brand_book

    @staticmethod
    def _fallback_brand_book(
        cleaned_text: str, company_name: str | None, product_name: str | None
    ) -> dict[str, Any]:
        """Deterministic brand book when API key is unavailable."""
        words = cleaned_text.lower().split()
        freq = {}
        for w in words:
            if len(w) > 4:
                freq[w] = freq.get(w, 0) + 1
        top_terms = sorted(freq, key=freq.get, reverse=True)[:8]

        return {
            "brand_voice": "professional, approachable",
            "color_palette": ["#1a1a2e", "#16213e", "#0f3460", "#e94560"],
            "typography_style": "modern sans-serif",
            "target_audience": "digital-native consumers",
            "key_selling_points": top_terms or ["quality", "innovation"],
            "cultural_notes": "Default en-US positioning; transcreation recommended for APAC.",
            "compliance_flags": [],
            "company_name": company_name,
            "product_name": product_name,
            "model": "fallback",
        }

    async def ingest_product(self, url: str) -> dict[str, Any]:
        """Full ingest pipeline: scrape → compress → brand book."""
        try:
            validate_public_url(url)
        except SSRFError:
            raise
        scraped = await self.scrape_and_clean_html(url)
        images = await self.prune_and_compress_images(scraped.pop("image_urls", []))
        brand_book = await self.generate_brand_book(
            scraped["cleaned_text"],
            images,
            scraped.get("company_name"),
            scraped.get("product_name"),
        )
        return {
            **scraped,
            "image_assets": {"images": images},
            "brand_book": brand_book,
        }
