import unittest
import json
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import scrapling_engine

from scrapling_engine import (
    build_capture_diagnostic,
    CAPTURE_RETRIES,
    collect_visible_work_ids,
    DiagnosticEngineError,
    error_response,
    extract_single_work,
    extract_work_ids,
    has_login_cookie,
    has_authenticated_profile_access,
    merge_payloads,
    normalize_payload,
    payload_requires_login,
    read_captured_payloads,
    supplement_missing_works,
    validate_request,
)


class FakeMouse:
    def __init__(self, page):
        self.page = page

    def wheel(self, _x, _y):
        self.page.round += 1


class FakeLocator:
    def __init__(self, page):
        self.page = page

    def evaluate_all(self, _script):
        index = min(self.page.round, len(self.page.href_batches) - 1)
        return self.page.href_batches[index]


class FakePage:
    def __init__(self, href_batches):
        self.href_batches = href_batches
        self.round = 0
        self.mouse = FakeMouse(self)

    def locator(self, _selector):
        return FakeLocator(self)

    def wait_for_timeout(self, _milliseconds):
        return None


class FakeResponse:
    def __init__(self, url, status, body):
        self.url = url
        self.status = status
        self.body = body


class EngineTests(unittest.TestCase):
    def test_protocol_vectors_match_json_lines_contract(self):
        vectors = json.loads((Path(__file__).parent.parent / "protocol-v1-vectors.json").read_text(encoding="utf-8"))

        self.assertEqual(len(vectors), 4)
        for vector in vectors:
            with self.subTest(stdin=vector["stdin"]):
                stdin = StringIO(json.dumps(vector["stdin"]) + "\n")
                stdout = StringIO()
                with patch.object(scrapling_engine.sys, "stdin", stdin), patch.object(scrapling_engine.sys, "stdout", stdout):
                    if vector["stdin"].get("command") == "login_status" and vector["stdout"].get("ok") is True:
                        with patch.object(scrapling_engine, "login_status", return_value=vector["stdout"]):
                            scrapling_engine.main()
                    elif vector["stdout"].get("error", {}).get("code") == "DOUYIN_BROWSER_NOT_FOUND":
                        with patch.object(scrapling_engine, "find_browser", side_effect=RuntimeError("DOUYIN_BROWSER_NOT_FOUND")):
                            scrapling_engine.main()
                    else:
                        scrapling_engine.main()
                self.assertEqual(json.loads(stdout.getvalue()), vector["stdout"])

    @staticmethod
    def make_payload(work_id, created):
        return {
            "status_code": 0,
            "aweme_list": [{
                "aweme_id": work_id,
                "desc": f"work-{work_id}",
                "create_time": created,
                "author": {"nickname": "creator", "sec_uid": "sec-1"},
                "statistics": {},
                "video": {},
            }],
        }

    def test_extracts_unique_video_ids_from_profile_html(self):
        html = (
            b'<a href="/video/7663141533167766803"></a>'
            b'<a href="https://www.douyin.com/video/7663141533167766803"></a>'
        )

        self.assertEqual(extract_work_ids(html), {"7663141533167766803"})

    def test_merges_multiple_payloads_and_deduplicates_by_work_id(self):
        first = self.make_payload("7663141533167766803", 1784318400)
        second = self.make_payload("7663141533167766803", 1784318400)

        creator, works = merge_payloads(
            [first, second],
            "https://www.douyin.com/user/sec-1",
        )

        self.assertEqual(creator["profileUrl"], "https://www.douyin.com/user/sec-1")
        self.assertEqual([work["id"] for work in works], ["7663141533167766803"])

    def test_caps_merged_works_to_protocol_limit_in_newest_first_order(self):
        payloads = [
            self.make_payload(str(7600000000000000000 + index), 1784318400 + index)
            for index in range(201)
        ]

        _creator, works = merge_payloads(payloads, "https://www.douyin.com/user/sec-1")

        self.assertEqual(len(works), 200)
        self.assertEqual(works[0]["id"], "7600000000000000200")
        self.assertEqual(works[-1]["id"], "7600000000000000001")

    def test_normalizes_a_work_detail_payload(self):
        work = self.make_payload("7663141533167766803", 1784318400)["aweme_list"][0]

        _creator, works = normalize_payload(
            {"status_code": 0, "aweme_detail": work},
            "https://www.douyin.com/user/example",
        )

        self.assertEqual([item["id"] for item in works], ["7663141533167766803"])

    def test_scroll_collects_union_and_stops_after_two_unchanged_rounds(self):
        page = FakePage([
            ["https://www.douyin.com/video/7663141533167766803"],
            [
                "https://www.douyin.com/video/7663141533167766803",
                "https://www.douyin.com/video/7660437934977404195",
            ],
            ["https://www.douyin.com/video/7660437934977404195"],
            ["https://www.douyin.com/video/7660437934977404195"],
        ])

        self.assertEqual(collect_visible_work_ids(page), {
            "7663141533167766803",
            "7660437934977404195",
        })
        self.assertEqual(page.round, 3)

    def test_scroll_never_returns_more_than_sixty_work_ids(self):
        hrefs = [f"https://www.douyin.com/video/{7600000000000000000 + index}" for index in range(65)]

        result = collect_visible_work_ids(FakePage([hrefs]))

        self.assertEqual(len(result), 60)

    def test_supplements_only_visible_ids_missing_from_post_payloads(self):
        existing = {"7660437934977404195": {"id": "7660437934977404195"}}
        calls = []

        def fetch_detail(work_id):
            calls.append(work_id)
            return self.make_payload(work_id, 1784318400)

        missing = supplement_missing_works(
            {"7660437934977404195", "7663141533167766803"},
            existing,
            fetch_detail,
            "https://www.douyin.com/user/sec-1",
        )

        self.assertEqual(calls, ["7663141533167766803"])
        self.assertEqual(missing, [])
        self.assertIn("7663141533167766803", existing)

    def test_records_a_missing_id_when_detail_capture_fails(self):
        existing = {}

        missing = supplement_missing_works(
            {"7663141533167766803"},
            existing,
            lambda _work_id: (_ for _ in ()).throw(RuntimeError("detail failed")),
            "https://www.douyin.com/user/example",
        )

        self.assertEqual(missing, ["7663141533167766803"])

    def test_rejects_supplement_from_another_creator(self):
        existing = {}
        foreign = self.make_payload("7663141533167766803", 1784318400)
        foreign["aweme_list"][0]["author"]["sec_uid"] = "other-sec"

        missing = supplement_missing_works(
            {"7663141533167766803"},
            existing,
            lambda _work_id: foreign,
            "https://www.douyin.com/user/sec-1",
        )

        self.assertEqual(missing, ["7663141533167766803"])
        self.assertEqual(existing, {})

    def test_detects_logged_out_profile_payload(self):
        self.assertTrue(payload_requires_login([{
            "status_code": 0,
            "not_login_module": {"guide_login_tip_exist": True},
            "aweme_list": [],
        }]))

    def test_does_not_reject_usable_works_when_response_also_contains_login_guide(self):
        payload = self.make_payload("7663141533167766803", 1784318400)
        payload["not_login_module"] = {"guide_login_tip_exist": True}

        self.assertFalse(payload_requires_login([payload]))

    def test_classifies_forbidden_capture_response_as_douyin_risk_control(self):
        page = type("CapturedPage", (), {"captured_xhr": [FakeResponse(
            "https://www.douyin.com/aweme/v1/web/aweme/post/?msToken=secret-token",
            403,
            b"",
        )]})()

        with self.assertRaises(DiagnosticEngineError) as raised:
            read_captured_payloads(page)

        self.assertEqual(raised.exception.code, "DOUYIN_RISK_CONTROL")
        self.assertEqual(raised.exception.diagnostic["responses"][0]["httpStatus"], 403)

    def test_builds_a_safe_diagnostic_from_real_response_metadata(self):
        payload = {
            "status_code": 0,
            "status_msg": "login required",
            "not_login_module": {"guide_login_tip_exist": True},
            "aweme_list": [],
            "log_pb": {"impr_id": "secret-impression-id"},
        }
        page = type("CapturedPage", (), {"captured_xhr": [FakeResponse(
            "https://www.douyin.com/aweme/v1/web/aweme/post/?msToken=secret-token",
            200,
            b'{"sessionid":"secret-cookie-value"}',
        )]})()

        diagnostic = build_capture_diagnostic(page, [payload])

        self.assertEqual(diagnostic["payloadCount"], 1)
        self.assertEqual(diagnostic["responses"][0]["urlPath"], "/aweme/v1/web/aweme/post/")
        self.assertEqual(diagnostic["responses"][0]["httpStatus"], 200)
        self.assertEqual(diagnostic["responses"][0]["bodyBytes"], 35)
        self.assertEqual(diagnostic["payloads"][0]["statusCode"], 0)
        self.assertTrue(diagnostic["payloads"][0]["loginGuide"])
        self.assertNotIn("secret-token", str(diagnostic))
        self.assertNotIn("secret-cookie-value", str(diagnostic))
        self.assertNotIn("secret-impression-id", str(diagnostic))

    def test_normalizes_boolean_response_status_to_null_in_diagnostics(self):
        page = type("CapturedPage", (), {"captured_xhr": [FakeResponse(
            "https://www.douyin.com/aweme/v1/web/aweme/post/",
            True,
            b"",
        )]})()

        diagnostic = build_capture_diagnostic(page, [])

        self.assertIsNone(diagnostic["responses"][0]["httpStatus"])

    def test_bounds_diagnostic_type_names_to_protocol_limits(self):
        long_type = type("V" * 101, (), {})
        diagnostic = build_capture_diagnostic(type("CapturedPage", (), {"captured_xhr": []})(), [long_type()])
        self.assertEqual(diagnostic["payloads"][0]["valueType"], "V" * 100)

        long_error = type("E" * 101, (RuntimeError,), {})
        response = error_response(long_error("failure"))
        self.assertEqual(response["error"]["diagnostic"]["exceptionType"], "E" * 100)

    def test_includes_safe_diagnostic_in_engine_error_response(self):
        response = error_response(DiagnosticEngineError(
            "DOUYIN_LOGIN_REQUIRED",
            {"payloadCount": 1, "responses": [], "payloads": [{"loginGuide": True}]},
        ))

        self.assertEqual(response["error"]["code"], "DOUYIN_LOGIN_REQUIRED")
        self.assertEqual(response["error"]["diagnostic"]["payloadCount"], 1)

    def test_classifies_navigation_timeout_as_retryable_network_failure(self):
        response = error_response(RuntimeError(
            'Page.goto: net::ERR_CONNECTION_TIMED_OUT at https://www.douyin.com/user/example'
        ))

        self.assertEqual(response["error"]["code"], "DOUYIN_NETWORK_TIMEOUT")
        self.assertEqual(CAPTURE_RETRIES, 2)

    def test_extracts_requested_single_work_from_detail_payload(self):
        raw = self.make_payload("7663141533167766803", 1784318400)["aweme_list"][0]
        payload = {"status_code": 0, "aweme_detail": raw}

        work = extract_single_work([payload], "7663141533167766803")

        self.assertEqual(work["id"], "7663141533167766803")

    def test_single_work_requires_login_when_detail_payload_has_login_wall(self):
        with self.assertRaisesRegex(RuntimeError, "DOUYIN_LOGIN_REQUIRED"):
            extract_single_work([{
                "not_login_module": {"guide_login_tip_exist": True},
                "aweme_list": [],
            }], "7663141533167766803")

    def test_normalizes_creator_works_and_metrics(self):
        creator, works = normalize_payload({
            "status_code": 0,
            "aweme_list": [{
                "aweme_id": "7659",
                "desc": "作品文案",
                "create_time": 1784073600,
                "author": {"nickname": "林克AI实战录", "sec_uid": "sec-1"},
                "statistics": {
                    "digg_count": 393, "comment_count": 25,
                    "share_count": 60, "collect_count": 329,
                },
                "video": {"play_addr": {"url_list": ["https://video.example/test.mp4"]}},
            }],
        }, "https://v.douyin.com/example/")

        self.assertEqual(creator["name"], "林克AI实战录")
        self.assertEqual(works[0]["likes"], 393)
        self.assertEqual(works[0]["downloadUrl"], "https://video.example/test.mp4")
        self.assertEqual(works[0]["originalUrl"], "https://www.douyin.com/video/7659")

    def test_rejects_non_ascii_work_ids_and_boolean_metrics(self):
        payload = self.make_payload("٧٦٦٣١٤١٥٣٣١٦٧٧٦٦٨٠٣", 1784318400)
        payload["aweme_list"][0]["statistics"] = {"digg_count": True}

        _creator, works = normalize_payload(payload, "https://www.douyin.com/user/example")

        self.assertEqual(works, [])

        payload = self.make_payload("7663141533167766803", 1784318400)
        payload["aweme_list"][0]["statistics"] = {"digg_count": True}
        _creator, works = normalize_payload(payload, "https://www.douyin.com/user/example")
        self.assertEqual(works[0]["likes"], 0)

    def test_rejects_non_douyin_profile_url(self):
        with self.assertRaisesRegex(ValueError, "INVALID_PROFILE_URL"):
            validate_request({
                "protocolVersion": 1, "command": "capture_creator",
                "creatorId": "creator-1", "profileUrl": "https://example.com/user",
                "profileDirectory": "C:\\Data\\profile",
            })

    def test_rejects_noncanonical_douyin_profile_urls(self):
        for profile_url in (
            "HTTPS://www.douyin.com/user/example",
            "https://WWW.douyin.com/user/example",
            "https://www.douyin.com:443/user/example",
        ):
            with self.subTest(profile_url=profile_url), self.assertRaisesRegex(ValueError, "INVALID_PROFILE_URL"):
                validate_request({
                    "protocolVersion": 1, "command": "capture_creator",
                    "creatorId": "creator-1", "profileUrl": profile_url,
                    "profileDirectory": "C:\\Data\\profile",
                })

    def test_bounds_normalized_work_titles_to_protocol_limit(self):
        payload = self.make_payload("7663141533167766803", 1784318400)
        payload["aweme_list"][0]["desc"] = "x" * 10_001

        _creator, works = normalize_payload(payload, "https://www.douyin.com/user/example")

        self.assertEqual(works[0]["title"], "x" * 10_000)

    def test_rejects_extra_request_fields_for_known_operations(self):
        for request in (
            {"protocolVersion": 1, "command": "health", "unexpected": True},
            {
                "protocolVersion": 1, "command": "login",
                "profileDirectory": "C:\\Data\\profile", "unexpected": True,
            },
        ):
            with self.subTest(request=request), self.assertRaisesRegex(ValueError, "INVALID_REQUEST"):
                validate_request(request)

    def test_rejects_non_windows_absolute_profile_directories(self):
        with self.assertRaisesRegex(ValueError, "INVALID_PROFILE_DIRECTORY"):
            validate_request({
                "protocolVersion": 1, "command": "login_status",
                "profileDirectory": "/tmp/profile",
            })

    def test_accepts_login_and_login_status_requests(self):
        for command in ("login", "login_status"):
            request = validate_request({
                "protocolVersion": 1,
                "command": command,
                "profileDirectory": "C:\\Data\\profile",
            })

            self.assertEqual(request["command"], command)

    def test_accepts_capture_video_request(self):
        request = validate_request({
            "protocolVersion": 1,
            "command": "capture_video",
            "videoId": "7663141533167766803",
            "profileDirectory": "C:\\Data\\profile",
        })

        self.assertEqual(request["videoId"], "7663141533167766803")

    def test_rejects_unicode_digit_video_ids(self):
        with self.assertRaisesRegex(ValueError, "INVALID_REQUEST"):
            validate_request({
                "protocolVersion": 1,
                "command": "capture_video",
                "videoId": "٧٦٦٣١٤١٥٣٣١٦٧٧٦٦٨٠٣",
                "profileDirectory": "C:\\Data\\profile",
            })

    def test_recognizes_real_login_cookie_not_device_cookie(self):
        self.assertTrue(has_login_cookie([{"name": "sessionid_ss"}]))
        self.assertFalse(has_login_cookie([{"name": "ttwid"}, {"name": "s_v_web_id"}]))

    def test_requires_a_real_authenticated_profile_response_for_login(self):
        self.assertTrue(has_authenticated_profile_access(
            [{"name": "sessionid"}],
            [{"status_code": 0, "aweme_list": []}],
        ))
        self.assertFalse(has_authenticated_profile_access(
            [{"name": "sessionid"}],
            [{"not_login_module": {"guide_login_tip_exist": True}}],
        ))
        self.assertFalse(has_authenticated_profile_access([{"name": "sessionid"}], []))

    def test_rejects_legacy_cookie_bridge(self):
        with self.assertRaisesRegex(ValueError, "INVALID_REQUEST"):
            validate_request({
                "protocolVersion": 1, "command": "capture_creator",
                "creatorId": "creator-1", "profileUrl": "https://www.douyin.com/user/example",
                "profileDirectory": "C:\\Data\\profile",
                "cookies": [{"name": "sessionid"}],
            })

if __name__ == "__main__":
    unittest.main()
