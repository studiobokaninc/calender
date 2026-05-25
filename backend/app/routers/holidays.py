import datetime
import logging
from typing import List, Optional
from fastapi import APIRouter, Query, HTTPException, status
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/holidays", tags=["Holidays"])

class HolidayResponse(BaseModel):
    date: str
    name: str

def get_japanese_holidays(year: int) -> List[dict]:
    """
    python-holidays ライブラリを使用して、指定された年の日本の祝日リストを取得します。
    """
    import holidays
    import datetime

    # 日本の祝日を取得
    # language="ja" を指定することで日本語の祝日名を取得
    try:
        jp_holidays = holidays.Japan(years=year, language="ja")
    except Exception:
        # 万が一古いバージョンなどでエラーが起きた場合はフォールバック
        jp_holidays = holidays.Japan(years=year)

    result = []
    # jp_holidays.items() から日付と名前を取得してソート
    for dt, name in sorted(jp_holidays.items()):
        result.append({
            "date": dt.isoformat(),
            "name": name
        })
    return result


@router.get("", response_model=List[HolidayResponse])
async def get_holidays(
    year: Optional[int] = Query(None, description="取得する年（指定がない場合は現在の年）")
):
    """
    指定された年の日本の祝日リスト（国民の祝日・振替休日・国民の休日）を取得します。
    """
    if year is None:
        year = datetime.datetime.now().year
    
    if year < 1980 or year > 2099:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="年は 1980 から 2099 の間で指定してください。"
        )

    try:
        holidays = get_japanese_holidays(year)
        return holidays
    except Exception as e:
        logger.error(f"Failed to calculate holidays for year {year}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="祝日の計算中にエラーが発生しました。"
        )
