"""Security utilities for URL validation and shell escaping."""

from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlparse

BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal"}
PRIVATE_NETWORKS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
)


class SSRFError(ValueError):
    pass


def validate_public_url(url: str) -> str:
    """Reject URLs that target private/internal networks (SSRF protection)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SSRFError("Only http and https URLs are allowed")
    if not parsed.hostname:
        raise SSRFError("URL must include a hostname")

    hostname = parsed.hostname.lower()
    if hostname in BLOCKED_HOSTNAMES:
        raise SSRFError(f"Blocked hostname: {hostname}")

    try:
        addr_infos = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise SSRFError(f"Cannot resolve hostname: {hostname}") from exc

    for info in addr_infos:
        ip = ipaddress.ip_address(info[4][0])
        for network in PRIVATE_NETWORKS:
            if ip in network:
                raise SSRFError(f"URL resolves to private/reserved IP: {ip}")

    return url


def escape_ffmpeg_drawtext(text: str) -> str:
    """Escape user text for ffmpeg drawtext filter."""
    escaped = text[:80]
    escaped = escaped.replace("\\", "\\\\")
    escaped = escaped.replace(":", "\\:")
    escaped = escaped.replace("'", "\\'")
    escaped = escaped.replace("%", "\\%")
    escaped = re.sub(r"[\r\n]", " ", escaped)
    return escaped
