import unittest

from scrapling_engine import normalize_payload, validate_request


class EngineTests(unittest.TestCase):
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

    def test_rejects_non_douyin_profile_url(self):
        with self.assertRaisesRegex(ValueError, "INVALID_PROFILE_URL"):
            validate_request({
                "protocolVersion": 1, "command": "capture_creator",
                "creatorId": "creator-1", "profileUrl": "https://example.com/user",
                "profileDirectory": "C:\\Data\\profile",
            })


if __name__ == "__main__":
    unittest.main()

