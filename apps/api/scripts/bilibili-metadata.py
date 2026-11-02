#!/usr/bin/env python3
"""Read public metadata and per-part durations in one anonymous library request."""

import asyncio
import json
import sys

from bilibili_api import video


async def main():
    if len(sys.argv) != 2:
        raise RuntimeError("usage: bilibili-metadata.py BVID")
    # The CLI uses this same library, but drops pages/rights from its JSON output.
    # Do not follow it with a separate unauthenticated HTTP request for those fields.
    item = video.Video(bvid=sys.argv[1])
    info = await asyncio.wait_for(item.get_info(), timeout=20)
    fields = ("bvid", "title", "owner", "pic", "pages", "rights", "redirect_url", "is_live")
    print(json.dumps({key: info.get(key) for key in fields}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
