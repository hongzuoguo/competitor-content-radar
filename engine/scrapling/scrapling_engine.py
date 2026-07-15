import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

PROTOCOL_VERSION = 1
ALLOWED_HOSTS = {"douyin.com", "www.douyin.com", "v.douyin.com"}


def validate_request(value):
    if not isinstance(value, dict) or value.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("PROTOCOL_UNSUPPORTED")
    command = value.get("command")
    if command == "health":
        return value
    if command != "capture_creator":
        raise ValueError("INVALID_COMMAND")
    profile_url = value.get("profileUrl")
    profile_directory = value.get("profileDirectory")
    creator_id = value.get("creatorId")
    if not isinstance(profile_url, str) or not isinstance(profile_directory, str) or not isinstance(creator_id, str):
        raise ValueError("INVALID_REQUEST")
    parsed = urlparse(profile_url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError("INVALID_PROFILE_URL")
    if not os.path.isabs(profile_directory):
        raise ValueError("INVALID_PROFILE_DIRECTORY")
    return value


def find_browser():
    candidates = []
    local = os.environ.get("LOCALAPPDATA")
    program_files = os.environ.get("PROGRAMFILES")
    program_files_x86 = os.environ.get("PROGRAMFILES(X86)")
    for root, suffix in [
        (local, os.path.join("Google", "Chrome", "Application", "chrome.exe")),
        (program_files, os.path.join("Google", "Chrome", "Application", "chrome.exe")),
        (program_files_x86, os.path.join("Google", "Chrome", "Application", "chrome.exe")),
        (local, os.path.join("Microsoft", "Edge", "Application", "msedge.exe")),
        (program_files, os.path.join("Microsoft", "Edge", "Application", "msedge.exe")),
        (program_files_x86, os.path.join("Microsoft", "Edge", "Application", "msedge.exe")),
    ]:
        if root:
            candidates.append(os.path.join(root, suffix))
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    raise RuntimeError("DOUYIN_BROWSER_NOT_FOUND")


def first_url(*addresses):
    for address in addresses:
        if not isinstance(address, dict):
            continue
        urls = address.get("url_list") or address.get("urlList") or []
        for value in urls:
            if isinstance(value, str) and value.startswith("https://"):
                return value
    return None


def count(value):
    return value if isinstance(value, int) and value >= 0 else 0


def normalize_payload(payload, requested_url):
    if not isinstance(payload, dict) or payload.get("status_code") not in (None, 0):
        raise RuntimeError("DOUYIN_CAPTURE_INVALID")
    raw_works = payload.get("aweme_list") or []
    creator = None
    works = []
    for raw in raw_works:
        if not isinstance(raw, dict):
            continue
        work_id = str(raw.get("aweme_id") or "")
        if not work_id.isdigit():
            continue
        author = raw.get("author") if isinstance(raw.get("author"), dict) else {}
        statistics = raw.get("statistics") if isinstance(raw.get("statistics"), dict) else {}
        video = raw.get("video") if isinstance(raw.get("video"), dict) else {}
        sec_uid = author.get("sec_uid")
        canonical_profile = f"https://www.douyin.com/user/{sec_uid}" if isinstance(sec_uid, str) and sec_uid else requested_url
        creator = creator or {"name": str(author.get("nickname") or "抖音博主"), "profileUrl": canonical_profile}
        created = raw.get("create_time")
        published = datetime.fromtimestamp(created, timezone.utc) if isinstance(created, (int, float)) else datetime.now(timezone.utc)
        works.append({
            "id": work_id,
            "title": str(raw.get("desc") or "抖音作品"),
            "publishedAt": published.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "originalUrl": f"https://www.douyin.com/video/{work_id}",
            "downloadUrl": first_url(video.get("play_addr"), video.get("playAddress"), video.get("download_addr"), video.get("downloadAddress")),
            "likes": count(statistics.get("digg_count")),
            "comments": count(statistics.get("comment_count")),
            "shares": count(statistics.get("share_count")),
            "collects": count(statistics.get("collect_count")),
        })
    if not creator:
        creator = {"name": "抖音博主", "profileUrl": requested_url}
    return creator, works


def capture_creator(request):
    from scrapling.fetchers import DynamicFetcher

    os.makedirs(request["profileDirectory"], exist_ok=True)
    page = DynamicFetcher.fetch(
        request["profileUrl"],
        executable_path=find_browser(),
        user_data_dir=request["profileDirectory"],
        headless=True,
        wait=8000,
        timeout=45000,
        disable_resources=True,
        google_search=False,
        locale="zh-CN",
        capture_xhr=r".*/aweme/v1/web/aweme/post/.*",
        retries=1,
    )
    works_by_id = {}
    creator = None
    for response in page.captured_xhr or []:
        payload = json.loads(response.body)
        current_creator, works = normalize_payload(payload, request["profileUrl"])
        creator = creator or current_creator
        for work in works:
            works_by_id[work["id"]] = work
    if not works_by_id:
        raise RuntimeError("DOUYIN_CAPTURE_EMPTY")
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": True,
        "creator": creator,
        "works": list(works_by_id.values()),
    }


def error_response(error):
    code = str(error)
    if code not in {
        "PROTOCOL_UNSUPPORTED", "INVALID_COMMAND", "INVALID_REQUEST", "INVALID_PROFILE_URL",
        "INVALID_PROFILE_DIRECTORY", "DOUYIN_BROWSER_NOT_FOUND", "DOUYIN_CAPTURE_INVALID",
        "DOUYIN_CAPTURE_EMPTY", "DOUYIN_RISK_CONTROL",
    }:
        code = "SCRAPLING_ENGINE_INTERNAL"
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": False,
        "error": {"code": code, "message": code},
    }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    try:
        line = sys.stdin.readline()
        request = validate_request(json.loads(line))
        if request["command"] == "health":
            output = {"protocolVersion": PROTOCOL_VERSION, "ok": True, "status": "ready"}
        else:
            output = capture_creator(request)
    except Exception as error:
        if os.environ.get("SCRAPLING_ENGINE_DEBUG") == "1":
            import traceback
            traceback.print_exc(file=sys.stderr)
        output = error_response(error)
    sys.stdout.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
