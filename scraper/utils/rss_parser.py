"""RSS/Atom feed parser utility.

Lightweight RSS parser using standard library xml.etree.ElementTree.
Handles both RSS 2.0 and Atom feeds commonly used by job boards and newsletters.
"""

import re
import requests
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime
from html import unescape
from typing import Optional
from email.utils import parsedate_to_datetime

from config import REQUEST_TIMEOUT


# Atom namespace
ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}


@dataclass
class RSSItem:
    """Represents a single RSS/Atom item."""
    title: str
    link: str
    description: str = ""
    pub_date: Optional[str] = None
    guid: Optional[str] = None
    author: Optional[str] = None
    categories: list[str] = field(default_factory=list)
    raw: dict = field(default_factory=dict)


@dataclass
class RSSFeed:
    """Represents an RSS/Atom feed."""
    title: str
    link: str
    description: str = ""
    items: list[RSSItem] = field(default_factory=list)
    last_build_date: Optional[str] = None


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    if not text:
        return ""
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Decode HTML entities
    text = unescape(text)
    # Normalize whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_date(date_str: Optional[str]) -> Optional[str]:
    """Parse various date formats to ISO format.

    Args:
        date_str: Date string in RFC 822, ISO 8601, or other common formats

    Returns:
        ISO formatted date string or None
    """
    if not date_str:
        return None

    date_str = date_str.strip()

    # Try RFC 822 format (common in RSS)
    try:
        dt = parsedate_to_datetime(date_str)
        return dt.isoformat()
    except (ValueError, TypeError):
        pass

    # Try ISO 8601 formats
    iso_formats = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ]

    for fmt in iso_formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.isoformat() + ("Z" if "Z" not in date_str and "+" not in date_str else "")
        except ValueError:
            continue

    return None


def get_text(element: Optional[ET.Element], default: str = "") -> str:
    """Safely extract text from an XML element."""
    if element is None:
        return default
    return element.text.strip() if element.text else default


def parse_rss_item(item: ET.Element, is_atom: bool = False) -> RSSItem:
    """Parse a single RSS or Atom item element.

    Args:
        item: XML element representing the item/entry
        is_atom: True if parsing Atom feed, False for RSS

    Returns:
        Parsed RSSItem
    """
    if is_atom:
        # Atom format
        title = get_text(item.find("atom:title", ATOM_NS))

        # Atom links are in attributes
        link_elem = item.find("atom:link[@rel='alternate']", ATOM_NS)
        if link_elem is None:
            link_elem = item.find("atom:link", ATOM_NS)
        link = link_elem.get("href", "") if link_elem is not None else ""

        # Content or summary
        content = item.find("atom:content", ATOM_NS)
        summary = item.find("atom:summary", ATOM_NS)
        description = get_text(content) or get_text(summary)

        pub_date = parse_date(get_text(item.find("atom:published", ATOM_NS)) or
                              get_text(item.find("atom:updated", ATOM_NS)))

        guid = get_text(item.find("atom:id", ATOM_NS)) or link

        author_elem = item.find("atom:author/atom:name", ATOM_NS)
        author = get_text(author_elem)

        categories = [
            cat.get("term", "")
            for cat in item.findall("atom:category", ATOM_NS)
            if cat.get("term")
        ]
    else:
        # RSS 2.0 format
        title = get_text(item.find("title"))
        link = get_text(item.find("link"))
        description = get_text(item.find("description"))
        pub_date = parse_date(get_text(item.find("pubDate")))
        guid = get_text(item.find("guid")) or link
        author = get_text(item.find("author")) or get_text(item.find("dc:creator"))

        categories = [
            get_text(cat)
            for cat in item.findall("category")
            if get_text(cat)
        ]

    return RSSItem(
        title=clean_html(title),
        link=link,
        description=clean_html(description),
        pub_date=pub_date,
        guid=guid,
        author=author,
        categories=categories,
    )


def parse_rss_feed(url: str, headers: Optional[dict] = None) -> Optional[RSSFeed]:
    """Fetch and parse an RSS or Atom feed.

    Args:
        url: URL of the RSS/Atom feed
        headers: Optional HTTP headers

    Returns:
        Parsed RSSFeed or None on error
    """
    default_headers = {
        "User-Agent": "NewGradRadar/1.0 (job aggregator for new grads)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
    }

    if headers:
        default_headers.update(headers)

    try:
        response = requests.get(url, headers=default_headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        content = response.text
    except requests.RequestException as e:
        print(f"Error fetching RSS feed {url}: {e}")
        return None

    try:
        # Parse XML
        root = ET.fromstring(content)
    except ET.ParseError as e:
        print(f"Error parsing RSS feed {url}: {e}")
        return None

    # Detect feed type
    is_atom = root.tag == "{http://www.w3.org/2005/Atom}feed" or root.tag == "feed"

    if is_atom:
        # Atom feed
        feed_title = get_text(root.find("atom:title", ATOM_NS)) or get_text(root.find("title"))

        link_elem = root.find("atom:link[@rel='alternate']", ATOM_NS)
        if link_elem is None:
            link_elem = root.find("atom:link", ATOM_NS) or root.find("link")
        feed_link = link_elem.get("href", "") if link_elem is not None else ""

        feed_desc = get_text(root.find("atom:subtitle", ATOM_NS)) or get_text(root.find("subtitle"))

        last_build = parse_date(get_text(root.find("atom:updated", ATOM_NS)) or
                                get_text(root.find("updated")))

        items = [
            parse_rss_item(entry, is_atom=True)
            for entry in root.findall("atom:entry", ATOM_NS) or root.findall("entry")
        ]
    else:
        # RSS 2.0 feed
        channel = root.find("channel")
        if channel is None:
            print(f"Invalid RSS feed {url}: no channel element")
            return None

        feed_title = get_text(channel.find("title"))
        feed_link = get_text(channel.find("link"))
        feed_desc = get_text(channel.find("description"))
        last_build = parse_date(get_text(channel.find("lastBuildDate")))

        items = [
            parse_rss_item(item, is_atom=False)
            for item in channel.findall("item")
        ]

    return RSSFeed(
        title=feed_title,
        link=feed_link,
        description=feed_desc,
        items=items,
        last_build_date=last_build,
    )


def fetch_multiple_feeds(urls: list[str]) -> list[RSSFeed]:
    """Fetch multiple RSS feeds.

    Args:
        urls: List of feed URLs

    Returns:
        List of successfully parsed feeds
    """
    feeds = []
    for url in urls:
        feed = parse_rss_feed(url)
        if feed:
            feeds.append(feed)
    return feeds
