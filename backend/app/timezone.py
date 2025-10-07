from datetime import datetime, timezone, timedelta


JST = timezone(timedelta(hours=9), name="JST")


def now_jst_naive() -> datetime:
	"""JSTの現在時刻をnaiveなdatetimeで返す（DBに既存データと整合）。"""
	return datetime.now(JST).replace(tzinfo=None)


def now_jst_aware() -> datetime:
	"""JSTの現在時刻をtimezone awareなdatetimeで返す。"""
	return datetime.now(JST)


