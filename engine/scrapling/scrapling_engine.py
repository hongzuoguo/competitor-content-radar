import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

PROTOCOL_VERSION = 1
ALLOWED_HOSTS = {"douyin.com", "www.douyin.com", "v.douyin.com"}
VIDEO_ID_PATTERN = re.compile(rb'(?:https://www\.douyin\.com)?/video/(\d{10,})')
MAX_WORKS = 60
MAX_SCROLL_ROUNDS = 20
UNCHANGED_ROUNDS_TO_STOP = 2
MAX_DETAIL_FETCHES = 10
CAPTURE_RETRIES = 2
LOGIN_COOKIE_NAMES = {"sessionid", "sessionid_ss", "sid_guard"}
WINDOWS_ABSOLUTE_PATH = re.compile(r'^(?:[A-Za-z]:[\\/].*|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/].*)?)$')
CANONICAL_DOUYIN_PROFILE_URL = re.compile(r'^https://(?:douyin\.com|www\.douyin\.com|v\.douyin\.com)(?:[/?#]|$)')
ASCII_WORK_ID = re.compile(r'^[0-9]+$')


class DiagnosticEngineError(RuntimeError):
    def __init__(self, code, diagnostic):
        super().__init__(code)
        self.code = code
        self.diagnostic = diagnostic


def validate_request(value):
    if not isinstance(value, dict) or value.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("PROTOCOL_UNSUPPORTED")
    command = value.get("command")
    if command == "health":
        if set(value) != {"protocolVersion", "command"}:
            raise ValueError("INVALID_REQUEST")
        return value
    if "cookies" in value:
        raise ValueError("INVALID_REQUEST")
    profile_directory = value.get("profileDirectory")
    if not isinstance(profile_directory, str) or not WINDOWS_ABSOLUTE_PATH.fullmatch(profile_directory):
        raise ValueError("INVALID_PROFILE_DIRECTORY")
    if command in {"login", "login_status"}:
        if set(value) != {"protocolVersion", "command", "profileDirectory"}:
            raise ValueError("INVALID_REQUEST")
        return value
    if command == "capture_video":
        if set(value) != {"protocolVersion", "command", "profileDirectory", "videoId"}:
            raise ValueError("INVALID_REQUEST")
        if not isinstance(value.get("videoId"), str) or not ASCII_WORK_ID.fullmatch(value["videoId"]):
            raise ValueError("INVALID_REQUEST")
        return value
    if command != "capture_creator":
        raise ValueError("INVALID_COMMAND")
    if set(value) != {"protocolVersion", "command", "creatorId", "profileUrl", "profileDirectory"}:
        raise ValueError("INVALID_REQUEST")
    profile_url = value.get("profileUrl")
    creator_id = value.get("creatorId")
    if not isinstance(profile_url, str) or not isinstance(creator_id, str):
        raise ValueError("INVALID_REQUEST")
    if not CANONICAL_DOUYIN_PROFILE_URL.match(profile_url):
        raise ValueError("INVALID_PROFILE_URL")
    parsed = urlparse(profile_url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError("INVALID_PROFILE_URL")
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
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def extract_work_ids(html):
    value = html if isinstance(html, bytes) else str(html).encode("utf-8")
    return {match.decode("ascii") for match in VIDEO_ID_PATTERN.findall(value)}


def payload_has_usable_work(payload):
    if not isinstance(payload, dict) or payload.get("status_code") not in (None, 0):
        return False
    raw_works = payload.get("aweme_list")
    if not isinstance(raw_works, list):
        detail = payload.get("aweme_detail")
        raw_works = [detail] if isinstance(detail, dict) else []
    return any(
        isinstance(work, dict) and ASCII_WORK_ID.fullmatch(str(work.get("aweme_id") or ""))
        for work in raw_works
    )


def payload_requires_login(payloads):
    if any(payload_has_usable_work(payload) for payload in payloads):
        return False
    return any(
        isinstance(payload, dict)
        and isinstance(payload.get("not_login_module"), dict)
        and payload["not_login_module"].get("guide_login_tip_exist") is True
        for payload in payloads
    )


def has_login_cookie(cookies):
    return any(
        isinstance(cookie, dict) and cookie.get("name") in LOGIN_COOKIE_NAMES
        for cookie in cookies
    )


def has_authenticated_profile_access(cookies, payloads):
    return has_login_cookie(cookies) and bool(payloads) and not payload_requires_login(payloads)


def collect_visible_work_ids(page):
    found = set()
    unchanged = 0
    for _ in range(MAX_SCROLL_ROUNDS):
        before = len(found)
        hrefs = page.locator('a[href*="/video/"]').evaluate_all(
            "elements => elements.map(element => element.href)"
        )
        found.update(extract_work_ids("\n".join(hrefs)))
        if len(found) >= MAX_WORKS:
            break
        unchanged = unchanged + 1 if len(found) == before else 0
        if unchanged >= UNCHANGED_ROUNDS_TO_STOP:
            break
        page.mouse.wheel(0, 1800)
        page.wait_for_timeout(1200)
    return set(sorted(found, reverse=True)[:MAX_WORKS])


def normalize_payload(payload, requested_url):
    if not isinstance(payload, dict) or payload.get("status_code") not in (None, 0):
        raise RuntimeError("DOUYIN_CAPTURE_INVALID")
    raw_works = payload.get("aweme_list") or []
    if not raw_works and isinstance(payload.get("aweme_detail"), dict):
        raw_works = [payload["aweme_detail"]]
    creator = None
    works = []
    for raw in raw_works:
        if not isinstance(raw, dict):
            continue
        work_id = str(raw.get("aweme_id") or "")
        if not ASCII_WORK_ID.fullmatch(work_id):
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
            "title": str(raw.get("desc") or "抖音作品")[:10_000],
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


def merge_payloads(payloads, requested_url):
    creator = None
    works_by_id = {}
    for payload in payloads:
        current_creator, works = normalize_payload(payload, requested_url)
        creator = creator or current_creator
        for work in works:
            works_by_id[work["id"]] = work
    fallback_creator = {"name": "抖音博主", "profileUrl": requested_url}
    works = sorted(works_by_id.values(), key=lambda work: work["publishedAt"], reverse=True)[:200]
    return creator or fallback_creator, works


def extract_single_work(payloads, video_id):
    if payload_requires_login(payloads):
        raise RuntimeError("DOUYIN_LOGIN_REQUIRED")
    for payload in payloads:
        _creator, works = normalize_payload(payload, f"https://www.douyin.com/video/{video_id}")
        for work in works:
            if work["id"] == video_id:
                return work
    raise RuntimeError("DOUYIN_CAPTURE_INVALID")


def read_captured_payloads(page):
    payloads = []
    for response in page.captured_xhr or []:
        status = getattr(response, "status", None)
        if not isinstance(status, int) or isinstance(status, bool):
            status = getattr(response, "status_code", None)
        if status in {401, 403, 429}:
            raise DiagnosticEngineError(
                "DOUYIN_RISK_CONTROL",
                build_capture_diagnostic(page, payloads),
            )
        try:
            payloads.append(json.loads(response.body))
        except (TypeError, json.JSONDecodeError):
            raise DiagnosticEngineError(
                "DOUYIN_CAPTURE_INVALID",
                build_capture_diagnostic(page, payloads),
            ) from None
    return payloads


def build_capture_diagnostic(page, payloads):
    responses = []
    for response in list(page.captured_xhr or [])[:20]:
        body = getattr(response, "body", b"")
        body_bytes = len(body.encode("utf-8")) if isinstance(body, str) else len(body or b"")
        url = str(getattr(response, "url", "") or "")
        parsed = urlparse(url)
        status = getattr(response, "status", None)
        if not isinstance(status, int) or isinstance(status, bool):
            status = getattr(response, "status_code", None)
        responses.append({
            "urlPath": parsed.path[:300],
            "httpStatus": status if isinstance(status, int) and not isinstance(status, bool) else None,
            "bodyBytes": body_bytes,
        })

    payload_diagnostics = []
    for payload in payloads[:20]:
        if not isinstance(payload, dict):
            payload_diagnostics.append({"valueType": type(payload).__name__[:100]})
            continue
        not_login = payload.get("not_login_module")
        works = payload.get("aweme_list")
        message = payload.get("status_msg")
        payload_diagnostics.append({
            "statusCode": payload.get("status_code"),
            "statusMessage": message[:300] if isinstance(message, str) else None,
            "loginGuide": isinstance(not_login, dict) and not_login.get("guide_login_tip_exist") is True,
            "awemeCount": len(works) if isinstance(works, list) else None,
            "keys": sorted(str(key)[:100] for key in payload.keys())[:40],
        })
    return {
        "payloadCount": len(payloads),
        "responses": responses,
        "payloads": payload_diagnostics,
    }


def sanitize_error_message(value):
    message = str(value)
    message = re.sub(r"(?i)(authorization:\s*bearer\s+)\S+", r"\1[REDACTED]", message)
    message = re.sub(r"(?i)(https?://[^\s?]+)\?[^\s]*", r"\1?[REDACTED_QUERY]", message)
    message = re.sub(
        r"(?i)([?&](?:msToken|token|sessionid|sid_guard|authorization)=)[^&\s]+",
        r"\1[REDACTED]",
        message,
    )
    return message[:500]


def profile_cookies(page):
    return page.context.cookies()


def login_status(request):
    from scrapling.fetchers import DynamicFetcher

    os.makedirs(request["profileDirectory"], exist_ok=True)
    cookies = []

    def inspect(page):
        cookies.extend(profile_cookies(page))

    page = DynamicFetcher.fetch(
        "https://www.douyin.com/user/self",
        executable_path=find_browser(),
        user_data_dir=request["profileDirectory"],
        headless=True,
        wait=1000,
        timeout=30000,
        disable_resources=True,
        google_search=False,
        locale="zh-CN",
        capture_xhr=r".*/aweme/v1/web/aweme/post/.*",
        page_action=inspect,
        retries=1,
    )
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": True,
        "loggedIn": has_authenticated_profile_access(cookies, read_captured_payloads(page)),
    }


def login(request):
    from scrapling.fetchers import DynamicFetcher

    os.makedirs(request["profileDirectory"], exist_ok=True)

    def wait_for_login(page):
        for _ in range(120):
            if has_login_cookie(profile_cookies(page)):
                return True
            page.wait_for_timeout(5000)
        raise RuntimeError("DOUYIN_LOGIN_CANCELLED")

    logged_in = DynamicFetcher.fetch(
        "https://www.douyin.com/",
        executable_path=find_browser(),
        user_data_dir=request["profileDirectory"],
        headless=False,
        wait=1500,
        timeout=660000,
        disable_resources=False,
        google_search=False,
        locale="zh-CN",
        page_action=wait_for_login,
        retries=1,
    )
    if not logged_in or not login_status(request)["loggedIn"]:
        raise RuntimeError("DOUYIN_LOGIN_CANCELLED")
    return {"protocolVersion": PROTOCOL_VERSION, "ok": True, "loggedIn": True}


def capture_video(request):
    from scrapling.fetchers import DynamicFetcher

    os.makedirs(request["profileDirectory"], exist_ok=True)
    page = DynamicFetcher.fetch(
        f"https://www.douyin.com/video/{request['videoId']}",
        executable_path=find_browser(),
        user_data_dir=request["profileDirectory"],
        headless=True,
        wait=2000,
        timeout=45000,
        disable_resources=True,
        google_search=False,
        locale="zh-CN",
        capture_xhr=r".*/aweme/v1/web/aweme/detail/.*",
        retries=1,
    )
    payloads = read_captured_payloads(page)
    if payload_requires_login(payloads):
        raise DiagnosticEngineError("DOUYIN_LOGIN_REQUIRED", build_capture_diagnostic(page, payloads))
    work = extract_single_work(payloads, request["videoId"])
    return {"protocolVersion": PROTOCOL_VERSION, "ok": True, "work": work}


def supplement_missing_works(visible_ids, works_by_id, fetch_detail, requested_url):
    missing = []
    for work_id in sorted(visible_ids - works_by_id.keys()):
        try:
            creator, works = normalize_payload(fetch_detail(work_id), requested_url)
            expected_path = urlparse(requested_url).path.rstrip("/")
            creator_path = urlparse(creator["profileUrl"]).path.rstrip("/")
            if creator_path != expected_path:
                missing.append(work_id)
                continue
            for work in works:
                works_by_id[work["id"]] = work
            if work_id not in works_by_id:
                missing.append(work_id)
        except Exception:
            missing.append(work_id)
    return missing


def capture_creator(request):
    from scrapling.fetchers import DynamicFetcher

    os.makedirs(request["profileDirectory"], exist_ok=True)
    visible_work_ids = set()

    def scan_profile(page):
        visible_work_ids.update(collect_visible_work_ids(page))

    page = DynamicFetcher.fetch(
        request["profileUrl"],
        executable_path=find_browser(),
        user_data_dir=request["profileDirectory"],
        headless=True,
        wait=2000,
        timeout=90000,
        disable_resources=True,
        google_search=False,
        locale="zh-CN",
        capture_xhr=r".*/aweme/v1/web/aweme/(?:post|detail)/.*",
        page_action=scan_profile,
        retries=CAPTURE_RETRIES,
        retry_delay=2,
    )
    payloads = read_captured_payloads(page)
    diagnostic = build_capture_diagnostic(page, payloads)
    if payload_requires_login(payloads):
        raise DiagnosticEngineError("DOUYIN_LOGIN_REQUIRED", diagnostic)
    creator, works = merge_payloads(payloads, request["profileUrl"])
    works_by_id = {work["id"]: work for work in works}
    if not works_by_id:
        raise DiagnosticEngineError("DOUYIN_CAPTURE_EMPTY", diagnostic)

    requested_missing_ids = sorted(visible_work_ids - works_by_id.keys())
    deferred_ids = requested_missing_ids[MAX_DETAIL_FETCHES:]

    def fetch_detail(work_id):
        detail_page = DynamicFetcher.fetch(
            f"https://www.douyin.com/video/{work_id}",
            executable_path=find_browser(),
            user_data_dir=request["profileDirectory"],
            headless=True,
            wait=2000,
            timeout=45000,
            disable_resources=True,
            google_search=False,
            locale="zh-CN",
            capture_xhr=r".*/aweme/v1/web/aweme/detail/.*",
            retries=1,
        )
        for response in detail_page.captured_xhr or []:
            payload = json.loads(response.body)
            detail = payload.get("aweme_detail") if isinstance(payload, dict) else None
            if isinstance(detail, dict) and str(detail.get("aweme_id") or "") == work_id:
                return payload
        raise RuntimeError("DOUYIN_CAPTURE_INVALID")

    missing_work_ids = supplement_missing_works(
        set(requested_missing_ids[:MAX_DETAIL_FETCHES]),
        works_by_id,
        fetch_detail,
        request["profileUrl"],
    )
    missing_work_ids.extend(deferred_ids)
    works = sorted(works_by_id.values(), key=lambda work: work["publishedAt"], reverse=True)[:200]
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": True,
        "creator": creator,
        "works": works,
        "complete": not missing_work_ids,
        "missingWorkIds": sorted(missing_work_ids),
        "pagesCaptured": len(payloads),
    }


def error_response(error):
    raw_code = error.code if isinstance(error, DiagnosticEngineError) else str(error)
    code = "DOUYIN_NETWORK_TIMEOUT" if any(marker in raw_code for marker in (
        "ERR_CONNECTION_TIMED_OUT",
        "ERR_TIMED_OUT",
        "TimeoutError",
    )) else raw_code
    if code not in {
        "PROTOCOL_UNSUPPORTED", "INVALID_COMMAND", "INVALID_REQUEST", "INVALID_PROFILE_URL",
        "INVALID_PROFILE_DIRECTORY", "DOUYIN_BROWSER_NOT_FOUND", "DOUYIN_CAPTURE_INVALID",
        "DOUYIN_CAPTURE_EMPTY", "DOUYIN_RISK_CONTROL", "DOUYIN_LOGIN_REQUIRED",
        "DOUYIN_LOGIN_CANCELLED", "DOUYIN_NETWORK_TIMEOUT",
    }:
        code = "SCRAPLING_ENGINE_INTERNAL"
    diagnostic = error.diagnostic if isinstance(error, DiagnosticEngineError) else {
        "exceptionType": type(error).__name__[:100],
        "errorMessage": sanitize_error_message(error),
    }
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": False,
        "error": {"code": code, "message": code, "diagnostic": diagnostic},
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
        elif request["command"] == "login":
            output = login(request)
        elif request["command"] == "login_status":
            output = login_status(request)
        elif request["command"] == "capture_video":
            output = capture_video(request)
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
