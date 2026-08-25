#!/usr/bin/env python3
"""Read subtitles or audio for one public Bilibili video part."""

import asyncio
import json
import os
import sys

import aiohttp
from bilibili_api import video
from bilibili_api.video import AudioQuality, VideoDownloadURLDataDetecter

MAX_AUDIO_BYTES = 512 * 1024 * 1024
HEADERS = {
    "User-Agent": "Mozilla/5.0 videoanalyze/1.0",
    "Origin": "https://www.bilibili.com",
    "Referer": "https://www.bilibili.com/",
}


async def subtitle(item: video.Video, page_index: int):
    pages = await item.get_pages()
    if page_index >= len(pages):
        raise RuntimeError("requested Bilibili part is unavailable")
    player = await item.get_player_info(cid=pages[page_index]["cid"])
    tracks = player.get("subtitle", {}).get("subtitles", [])
    if not tracks:
        print(json.dumps({"items": []}, ensure_ascii=False))
        return
    track = next((entry for entry in tracks if "zh" in entry.get("lan", "").lower()), tracks[0])
    url = track.get("subtitle_url", "")
    if url.startswith("//"):
        url = "https:" + url
    async with aiohttp.ClientSession(headers=HEADERS) as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
            response.raise_for_status()
            payload = await response.json()
    print(json.dumps({"items": payload.get("body", [])}, ensure_ascii=False))


async def audio(item: video.Video, page_index: int, output_dir: str):
    download = await item.get_download_url(page_index=page_index)
    detector = VideoDownloadURLDataDetecter(download)
    streams = detector.detect_best_streams(audio_max_quality=AudioQuality._64K, no_dolby_audio=True, no_hires=True)
    candidates = [stream for stream in streams if stream is not None and hasattr(stream, "audio_quality")]
    if not candidates and not detector.check_flv_mp4_stream() and len(streams) >= 2 and streams[1] is not None:
        candidates = [streams[1]]
    if not candidates:
        raise RuntimeError("public audio stream is unavailable")
    os.makedirs(output_dir, exist_ok=True)
    target = os.path.join(output_dir, "source.m4a")
    total = 0
    async with aiohttp.ClientSession(headers=HEADERS) as session:
        async with session.get(candidates[0].url, timeout=aiohttp.ClientTimeout(total=300)) as response:
            response.raise_for_status()
            with open(target, "wb") as handle:
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_AUDIO_BYTES:
                        raise RuntimeError("audio exceeds 512 MiB limit")
                    handle.write(chunk)


async def main():
    if len(sys.argv) not in (4, 5) or sys.argv[1] not in ("subtitle", "audio"):
        raise RuntimeError("usage: bilibili-part.py subtitle|audio BVID PART [OUTPUT_DIR]")
    mode, bvid, part_text = sys.argv[1:4]
    page_index = int(part_text) - 1
    if page_index < 0:
        raise RuntimeError("part must be positive")
    item = video.Video(bvid=bvid)
    if mode == "subtitle":
        await subtitle(item, page_index)
    elif len(sys.argv) == 5:
        await audio(item, page_index, sys.argv[4])
    else:
        raise RuntimeError("audio mode requires OUTPUT_DIR")


if __name__ == "__main__":
    asyncio.run(main())
