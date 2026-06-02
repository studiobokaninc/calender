import unittest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db, SessionLocal
from app import models, security
from datetime import datetime

class TestAPIV3(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.db = SessionLocal()

        # テスト用ユーザーの取得または作成
        cls.test_user = cls.db.query(models.User).filter(models.User.email == "test@example.com").first()
        if not cls.test_user:
            cls.test_user = models.User(
                email="test@example.com",
                hashed_password=security.get_password_hash("password"),
                username="testuser",
                full_name="テストユーザー",
                role="admin"
            )
            cls.db.add(cls.test_user)
            cls.db.commit()
            cls.db.refresh(cls.test_user)
        else:
            cls.test_user.avatar_url = None
            cls.db.commit()
            cls.db.refresh(cls.test_user)

        # 認証トークンの作成
        cls.token = security.create_access_token(data={"sub": cls.test_user.email})
        cls.headers = {"Authorization": f"Bearer {cls.token}"}

        # テスト用プロジェクトの取得または作成
        cls.project = cls.db.query(models.Project).first()
        if not cls.project:
            cls.project = models.Project(
                name="テストプロジェクト",
                description="テスト用のプロジェクトです",
                status=models.ProjectStatus.IN_PROGRESS
            )
            cls.db.add(cls.project)
            cls.db.commit()
            cls.db.refresh(cls.project)

        # テスト用イベントの取得または作成
        cls.event = cls.db.query(models.Event).first()
        if not cls.event:
            cls.event = models.Event(
                project_id=cls.project.id,
                title="テスト会議イベント",
                description="テストイベントです",
                start_time=datetime.now(),
                end_time=datetime.now(),
                type=models.EventType.MEETING
            )
            cls.db.add(cls.event)
            cls.db.commit()
            cls.db.refresh(cls.event)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def test_01_prefix_aliasing(self):
        """§1: /api/projects の二重プレフィックス (エイリアス) の疎通テスト"""
        response = self.client.get("/api/projects", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)
        print("OK: Prefix Aliasing (/api/projects) works perfectly!")

    def test_02_get_holidays(self):
        """§2.1: GET /api/holidays?year=2026 のテスト"""
        response = self.client.get("/api/holidays?year=2026", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        holidays = response.json()
        self.assertIsInstance(holidays, list)
        self.assertTrue(len(holidays) > 0)
        # 元日が含まれているか検証
        ganjitsu = [h for h in holidays if h["name"] == "元日"]
        self.assertTrue(len(ganjitsu) > 0)
        self.assertEqual(ganjitsu[0]["date"], "2026-01-01")
        print("OK: GET /api/holidays calculation works perfectly!")

    def test_03_get_avatar(self):
        """§2.2: GET /api/users/{id}/avatar (頭文字SVG動的生成) のテスト"""
        response = self.client.get(f"/api/users/{self.test_user.id}/avatar", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/svg+xml")
        self.assertIn("<svg", response.text)
        print("OK: GET /api/users/{id}/avatar dynamic SVG works perfectly!")

    def test_04_create_manual_meeting(self):
        """§2.5: POST /api/projects/{id}/meetings (手動議事録作成) のテスト"""
        payload = {
            "title": "テスト手動議事録",
            "project_id": self.project.id,
            "event_id": self.event.id,
            "transcript": "会議の文字起こしテキストです",
            "decisions": ["決定事項1", "決定事項2"],
            "tasks": ["宿題タスク1"],
            "deadlines": ["2026-06-30"],
            "attendees": [{"user_id": self.test_user.id, "name": self.test_user.full_name}]
        }
        response = self.client.post(f"/api/projects/{self.project.id}/meetings", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["title"], "テスト手動議事録")
        self.assertEqual(data["event_id"], self.event.id)
        self.assertEqual(data["transcript"], "会議の文字起こしテキストです")
        self.assertEqual(data["decisions"], ["決定事項1", "決定事項2"])
        
        self.__class__.meeting_id = data["id"]
        print("OK: POST /api/projects/{id}/meetings manual creation works perfectly!")

    def test_05_get_meeting_details(self):
        """§2.4: GET /api/meetings/{meeting_id} のテスト"""
        response = self.client.get(f"/api/meetings/{self.meeting_id}", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], self.meeting_id)
        self.assertEqual(data["title"], "テスト手動議事録")
        print("OK: GET /api/meetings/{meeting_id} details works perfectly!")

    def test_06_patch_meeting(self):
        """§2.6: PATCH /api/meetings/{meeting_id} (手動編集) のテスト"""
        payload = {
            "title": "更新されたテスト手動議事録",
            "decisions": ["決定事項1", "決定事項2", "決定事項3(追加)"]
        }
        response = self.client.patch(f"/api/meetings/{self.meeting_id}", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["title"], "更新されたテスト手動議事録")
        self.assertEqual(data["decisions"], ["決定事項1", "決定事項2", "決定事項3(追加)"])
        print("OK: PATCH /api/meetings/{meeting_id} update works perfectly!")

    def test_07_get_event_meetings(self):
        """§2.3: GET /api/events/{event_id}/meetings のテスト"""
        response = self.client.get(f"/api/events/{self.event.id}/meetings", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("meetings", data)
        self.assertTrue(len(data["meetings"]) > 0)
        self.assertEqual(data["meetings"][0]["event_id"], self.event.id)
        print("OK: GET /api/events/{event_id}/meetings retrieval works perfectly!")

    def test_08_new_aliased_routes(self):
        """§1: 全エンドポイントの /api プレフィックス二重化テスト"""
        # GET /api/calendar/events の検証
        res_events = self.client.get("/api/calendar/events", headers=self.headers)

        self.assertEqual(res_events.status_code, 200)
        self.assertIsInstance(res_events.json(), list)

        # GET /api/notes の検証
        res_notes = self.client.get("/api/notes", headers=self.headers)
        self.assertEqual(res_notes.status_code, 200)
        self.assertIsInstance(res_notes.json(), list)

        print("OK: All endpoints successfully dual-routed with /api prefix!")

    def test_09_disabled_user_login(self):
        """§3.5: 退職者アカウント (is_active=False) のログイン・APIアクセス拒否テスト"""
        # 非アクティブ（退職済）なテストユーザーを作成
        disabled_user = self.db.query(models.User).filter(models.User.email == "retired@example.com").first()
        if not disabled_user:
            disabled_user = models.User(
                email="retired@example.com",
                hashed_password=security.get_password_hash("password"),
                username="retired_user",
                full_name="退職したスタッフ",
                role="user",
                is_active=False
            )
            self.db.add(disabled_user)
            self.db.commit()
            self.db.refresh(disabled_user)

        # 1. ログイン（トークン取得）が失敗することを確認 (authenticate_userで弾かれる)
        payload = {"username": "retired@example.com", "password": "password"}
        res_login = self.client.post("/api/auth/token", data=payload)
        self.assertEqual(res_login.status_code, 401)

        # 2. すでにトークンが発行されていたとしても、APIアクセス時に 403 Forbidden になることを確認 (get_current_userで弾かれる)
        legacy_token = security.create_access_token(data={"sub": disabled_user.email})
        headers = {"Authorization": f"Bearer {legacy_token}"}
        res_api = self.client.get("/api/users/me", headers=headers)
        self.assertEqual(res_api.status_code, 403)
        self.assertIn("無効化", res_api.json()["detail"])

        print("OK: Disabled user login and API access is blocked perfectly!")

    def test_10_overpaint_retake(self):
        """§5: オーバーペイント付きリテイク作成と取得の疎通テスト"""
        # テスト用のプロジェクトの display_status を 'online' に確保
        self.project.display_status = "online"
        self.db.add(self.project)
        self.db.commit()

        # テスト用プロジェクトに紐づくショットを取得または作成
        shot = self.db.query(models.Shot).filter(
            models.Shot.project_id == self.project.id,
            models.Shot.seq_code == "SEQ_01",
            models.Shot.shot_code == "SHOT_999_TEST"
        ).first()
        if not shot:
            shot = models.Shot(
                shot_code="SHOT_999_TEST",
                project_id=self.project.id,
                status="in_progress",
                seq_code="SEQ_01"
            )
            self.db.add(shot)
            self.db.commit()
            self.db.refresh(shot)

        # 1. paint_image ＆ paint_mime を含むリテイクを作成 (POST /api/retakes)
        payload = {
            "shot_id": shot.id,
            "overall_comment": "オーバーペイントテスト用リテイク全体指示",
            "priority": "high",
            "deadline": "2026-06-01T12:00:00",
            "timecodes": [
                {
                    "timecode": "00:01:23:12",
                    "comment": "この部分のカラーを修正してください",
                    "paint_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                    "paint_mime": "image/png"
                }
            ]
        }
        response = self.client.post("/api/retakes", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["shot_id"], shot.id)
        self.assertEqual(data["overall_comment"], "オーバーペイントテスト用リテイク全体指示")
        
        # タイムコード側にペイントが保存されているか検証
        self.assertEqual(len(data["timecodes"]), 1)
        tc_data = data["timecodes"][0]
        self.assertEqual(tc_data["timecode"], "00:01:23:12")
        self.assertEqual(tc_data["paint_image"], "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
        self.assertEqual(tc_data["paint_mime"], "image/png")

        # 2. リテイク一覧取得 (GET /api/retakes) でもペイントデータが同梱されるか確認
        retake_id = data["id"]
        res_list = self.client.get(f"/api/retakes?shot_id={shot.id}", headers=self.headers)
        self.assertEqual(res_list.status_code, 200)
        list_data = res_list.json()
        self.assertTrue(len(list_data) > 0)
        matched_retakes = [r for r in list_data if r["id"] == retake_id]
        self.assertEqual(len(matched_retakes), 1)
        r_matched = matched_retakes[0]
        self.assertEqual(len(r_matched["timecodes"]), 1)
        self.assertEqual(r_matched["timecodes"][0]["paint_image"], "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

        print("OK: Overpaint retake comments creation and retrieval works perfectly!")

    def test_11_profile_expansion(self):
        """§5-bis: ユーザープロフィール拡張 API の疎通・権限判定テスト"""
        import pytz
        today_jst = datetime.now(pytz.timezone('Asia/Tokyo')).date()
        today_bday_str = f"1995-{today_jst.month:02d}-{today_jst.day:02d}T00:00:00"
        today_bday_dt = datetime(1992, today_jst.month, today_jst.day)

        # 1. 自身のプロフィールを更新 (PATCH /api/me/profile)
        payload_update = {
            "birthday": today_bday_str,  # 今日が誕生日になるように設定
            "bio": "Maya と Nuke のコンポジターです。",
            "phone": "090-1234-5678",
            "line_id": "test_line_999",
            "work_start_time": "10:00",
            "work_end_time": "19:00",
            "skills": ["Maya", "Nuke"],
            "settings_json": {"theme": "dark", "language": "ja"}
        }
        res_patch = self.client.patch("/api/me/profile", json=payload_update, headers=self.headers)
        self.assertEqual(res_patch.status_code, 200)
        data_my = res_patch.json()
        self.assertEqual(data_my["bio"], "Maya と Nuke のコンポジターです。")
        self.assertEqual(data_my["line_id"], "test_line_999")
        self.assertEqual(data_my["skills"], ["Maya", "Nuke"])

        # 2. 自身のプロフィールを取得 (GET /api/me/profile)
        res_get_my = self.client.get("/api/me/profile", headers=self.headers)
        self.assertEqual(res_get_my.status_code, 200)
        self.assertEqual(res_get_my.json()["phone"], "090-1234-5678")

        # 3. テスト用の別ユーザーを作成
        other_user = self.db.query(models.User).filter(models.User.email == "other@example.com").first()
        if not other_user:
            other_user = models.User(
                email="other@example.com",
                hashed_password=security.get_password_hash("password"),
                username="otheruser",
                full_name="同僚スタッフ",
                role="user",
                is_active=True,
                birthday=today_bday_dt, # 今日が誕生日
                phone="080-8765-4321",
                line_id="other_line"
            )
            self.db.add(other_user)
            self.db.commit()
            self.db.refresh(other_user)
        else:
            other_user.birthday = today_bday_dt
            self.db.commit()
            self.db.refresh(other_user)

        # 4. プロジェクトでの関係性ロールを設定 (同僚を同じプロジェクトに配置)
        role_me = self.db.query(models.ScoreUserRole).filter(
            models.ScoreUserRole.user_id == self.test_user.id,
            models.ScoreUserRole.project_id == self.project.id
        ).first()
        if not role_me:
            role_me = models.ScoreUserRole(user_id=self.test_user.id, project_id=self.project.id, role="director")
            self.db.add(role_me)
            
        role_other = self.db.query(models.ScoreUserRole).filter(
            models.ScoreUserRole.user_id == other_user.id,
            models.ScoreUserRole.project_id == self.project.id
        ).first()
        if not role_other:
            role_other = models.ScoreUserRole(user_id=other_user.id, project_id=self.project.id, role="compositor")
            self.db.add(role_other)
        self.db.commit()

        # 5. 他者として同僚のプロフィールを取得 (GET /api/users/{id}/profile)
        res_get_other = self.client.get(f"/api/users/{other_user.id}/profile", headers=self.headers)
        self.assertEqual(res_get_other.status_code, 200)
        data_other = res_get_other.json()
        
        # 同プロジェクトメンバーなので birthday, line_id は開示される
        self.assertIsNotNone(data_other["birthday"])
        self.assertEqual(data_other["line_id"], "other_line")
        # 🔒 管理者 (test_user.role == 'admin') なので緊急連絡先 (phone) も開示される
        self.assertEqual(data_other["phone"], "080-8765-4321")
        # 🚫 本人のみの設定 (settings_json, google_linked) は隠される (None/False)
        self.assertIsNone(data_other["settings_json"])
        self.assertEqual(data_other["google_linked"], False)

        # 6. 当日誕生日の同僚リストの取得 (GET /api/users/birthdays_today?project_id=...)
        res_bday = self.client.get(f"/api/users/birthdays_today?project_id={self.project.id}", headers=self.headers)
        self.assertEqual(res_bday.status_code, 200)
        data_bday = res_bday.json()
        
        # 今日誕生日の同僚がリストに含まれているか検証
        birthday_user_ids = [u["user_id"] for u in data_bday]
        self.assertIn(other_user.id, birthday_user_ids)
        # 年が隠されているか（公開部分のみであるか）
        buddy = [u for u in data_bday if u["user_id"] == other_user.id][0]
        self.assertEqual(buddy["name"], "同僚スタッフ")
        self.assertNotIn("birthday", buddy)  # response スキーマで birthday 自体が除外されていること

        print("OK: User profile expansion (GET/PATCH, permission checks, and birthdays list) works perfectly!")

    def test_12_get_my_events_filtering(self):
        """§5-bis: /api/me/events の条件(A)/(B)によるイベント取得テスト"""
        # アクターがメンバーであるプロジェクトを作成、または既存を使う
        proj = self.project
        
        # アクターをプロジェクトメンバーに設定 (ScoreUserRole)
        role = self.db.query(models.ScoreUserRole).filter(
            models.ScoreUserRole.user_id == self.test_user.id,
            models.ScoreUserRole.project_id == proj.id
        ).first()
        if not role:
            role = models.ScoreUserRole(user_id=self.test_user.id, project_id=proj.id, role="director")
            self.db.add(role)
            self.db.commit()
            
        # テストイベントを3種類作成
        # 1. 条件(A) アクターの user_id が user_ids に含まれる個人イベント
        evt_personal = models.Event(
            project_id=proj.id,
            title="My Personal Event 999",
            description="Personal Event Description",
            start_time=datetime.now(),
            end_time=datetime.now(),
            type=models.EventType.MEETING,
            user_ids=[self.test_user.id]
        )
        # 2. 条件(B) user_ids が空、かつアクターがメンバーであるプロジェクトの共有イベント
        evt_shared = models.Event(
            project_id=proj.id,
            title="Project Shared Event 999",
            description="Shared Event Description",
            start_time=datetime.now(),
            end_time=datetime.now(),
            type=models.EventType.MILESTONE,
            user_ids=[]
        )
        # 3. 除外条件: user_ids が空、かつアクターがメンバーではない他プロジェクトの共有イベント
        evt_other_shared = models.Event(
            project_id=proj.id + 100, # 無関係のプロジェクトID
            title="Other Project Shared Event 999",
            description="Other Shared Description",
            start_time=datetime.now(),
            end_time=datetime.now(),
            type=models.EventType.MILESTONE,
            user_ids=[]
        )
        # 4. 条件(B)の拡張: 自分がメンバーであるプロジェクトで、かつ他人のみが user_ids に登録されているイベント
        evt_other_assigned = models.Event(
            project_id=proj.id,
            title="Other User Event in My Project 999",
            description="Other User Description",
            start_time=datetime.now(),
            end_time=datetime.now(),
            type=models.EventType.MEETING,
            user_ids=[self.test_user.id + 1000]
        )
        
        self.db.add(evt_personal)
        self.db.add(evt_shared)
        self.db.add(evt_other_shared)
        self.db.add(evt_other_assigned)
        self.db.commit()
        self.db.refresh(evt_personal)
        self.db.refresh(evt_shared)
        self.db.refresh(evt_other_shared)
        self.db.refresh(evt_other_assigned)
        
        # /api/me/events をリクエスト
        res = self.client.get("/api/me/events", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        events_data = res.json()
        
        titles = [e["title"] for e in events_data]
        
        # 個人イベントとプロジェクト共有イベントが含まれていること
        self.assertIn("My Personal Event 999", titles)
        self.assertIn("Project Shared Event 999", titles)
        self.assertIn("Other User Event in My Project 999", titles)
        # メンバーではない別プロジェクトの共有イベントは含まれていないこと
        self.assertNotIn("Other Project Shared Event 999", titles)
        
        # 仮想フィールド date, time の出力テスト
        personal_res = [e for e in events_data if e["title"] == "My Personal Event 999"][0]
        self.assertIsNotNone(personal_res.get("date"))
        self.assertIsNotNone(personal_res.get("time"))
        self.assertIsNotNone(personal_res.get("duration_minutes"))

        # 新規作成 (POST) 時の仮想フィールド入力逆変換テスト
        post_payload = {
            "title": "Time Field POST Test Event",
            "type": "Meeting",
            "project_id": proj.id,
            "date": "2026-06-05",
            "time": "14:30",
            "duration_minutes": 45,
            "user_ids": [self.test_user.id]
        }
        res_post = self.client.post("/api/calendar/events", json=post_payload, headers=self.headers)
        self.assertEqual(res_post.status_code, 201)
        post_data = res_post.json()
        
        # start_time / end_time に変換されていること
        self.assertIn("2026-06-05T14:30:00", post_data["start_time"])
        self.assertIn("2026-06-05T15:15:00", post_data["end_time"]) # 14:30 + 45m = 15:15
        self.assertEqual(post_data["allDay"], False)

        # 更新 (PUT) 時の仮想フィールド入力逆変換テスト
        put_payload = {
            "time": "15:00",
            "duration_minutes": 90
        }
        res_put = self.client.put(f"/api/calendar/events/{post_data['id']}", json=put_payload, headers=self.headers)
        self.assertEqual(res_put.status_code, 200)
        put_data = res_put.json()
        
        # 時間が変更されていること
        self.assertIn("2026-06-05T15:00:00", put_data["start_time"])
        self.assertIn("2026-06-05T16:30:00", put_data["end_time"]) # 15:00 + 90m = 16:30
        
        # クリーンアップ (作成したイベントを削除)
        res_del = self.client.delete(f"/api/calendar/events/{post_data['id']}", headers=self.headers)
        self.assertEqual(res_del.status_code, 204)
        
        # クリーンアップ
        self.db.delete(evt_personal)
        self.db.delete(evt_shared)
        self.db.delete(evt_other_shared)
        self.db.delete(evt_other_assigned)
        self.db.commit()
        
        print("OK: /api/me/events filter conditions, virtual fields serializations, and reverse-conversion logic verified perfectly!")

    def test_13_avatar_upload_and_fallback(self):
        """アバターのアップロード、フォールバックURL、及び取得APIのテスト"""
        # 1. 自身の情報を取得して avatar_url が fallback URL であることを確認
        res_me = self.client.get("/api/users/me", headers=self.headers)
        self.assertEqual(res_me.status_code, 200)
        self.assertEqual(res_me.json()["avatar_url"], f"/api/users/{self.test_user.id}/avatar")

        # 2. プロフィール情報を取得して avatar_url が fallback URL であることを確認
        res_prof = self.client.get("/api/me/profile", headers=self.headers)
        self.assertEqual(res_prof.status_code, 200)
        self.assertEqual(res_prof.json()["avatar_url"], f"/api/users/{self.test_user.id}/avatar")

        # 3. アバターをダミー画像でアップロード
        import io
        dummy_file = io.BytesIO(b"fake image data")
        response = self.client.post(
            "/api/me/avatar",
            files={"file": ("test_avatar.png", dummy_file, "image/png")},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("avatar_url", response.json())

        # 4. アップロード後にアバター取得APIを叩いて、アップロードした画像が返ることを確認
        res_avatar = self.client.get(f"/api/users/{self.test_user.id}/avatar", headers=self.headers)
        self.assertEqual(res_avatar.status_code, 200)
        self.assertEqual(res_avatar.content, b"fake image data")

        # 5. 不正なファイル形式をアップロードしてエラーになることを確認
        dummy_txt = io.BytesIO(b"fake text data")
        res_fail = self.client.post(
            "/api/me/avatar",
            files={"file": ("test_avatar.txt", dummy_txt, "text/plain")},
            headers=self.headers
        )
        self.assertEqual(res_fail.status_code, 400)
        self.assertIn("許可されていない", res_fail.json()["detail"])

        # クリーンアップ (DBのavatar_urlをリセットし、アップロードされたファイルを物理削除)
        import os
        from pathlib import Path
        db_user = self.db.query(models.User).filter(models.User.id == self.test_user.id).first()
        if db_user and db_user.avatar_url:
            filename = os.path.basename(db_user.avatar_url)
            file_path = Path("static") / "uploads" / "avatars" / filename
            if file_path.exists():
                file_path.unlink()
            db_user.avatar_url = None
            self.db.commit()

        print("OK: Avatar upload, fallback URL, and serving tests passed successfully!")

    def test_avatar_xactor_proxy(self):
        """X-Actor-User-Id ヘッダによる管理者Bot代理アバターアップロードのテスト"""
        import io

        # 代理対象の非adminユーザーを作成
        target_user = self.db.query(models.User).filter(models.User.email == "proxy_target@example.com").first()
        if not target_user:
            target_user = models.User(
                email="proxy_target@example.com",
                hashed_password=security.get_password_hash("password"),
                username="proxy_target",
                full_name="代理対象ユーザー",
                role="member"
            )
            self.db.add(target_user)
            self.db.commit()
            self.db.refresh(target_user)

        # adminトークン + X-Actor-User-Id で対象ユーザーのアバターをアップロード
        proxy_headers = {**self.headers, "X-Actor-User-Id": str(target_user.id)}
        dummy_file = io.BytesIO(b"proxy avatar data")
        response = self.client.post(
            "/api/me/avatar",
            files={"file": ("proxy_avatar.png", dummy_file, "image/png")},
            headers=proxy_headers
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("avatar_url", response.json())

        # 対象ユーザーのアバター取得でプロキシ経由のデータが返ることを確認
        res_avatar = self.client.get(f"/api/users/{target_user.id}/avatar", headers=self.headers)
        self.assertEqual(res_avatar.status_code, 200)
        self.assertEqual(res_avatar.content, b"proxy avatar data")

        # クリーンアップ
        import os
        from pathlib import Path
        self.db.refresh(target_user)
        if target_user.avatar_url:
            filename = os.path.basename(target_user.avatar_url)
            file_path = Path("static") / "uploads" / "avatars" / filename
            if file_path.exists():
                file_path.unlink()
            target_user.avatar_url = None
        self.db.delete(target_user)
        self.db.commit()

        print("OK: X-Actor-User-Id proxy avatar upload test passed!")


if __name__ == "__main__":
    unittest.main()
