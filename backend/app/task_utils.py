import re
from typing import Optional

# 推奨されるタスクタイプ（値はすべて小文字）
RECOMMENDED_TASK_TYPES = [
    'design', 
    'documentation', 
    'testing', 
    'review', 
    'meeting', 
    'fx', 
    'asset', 
    'animation', 
    'lighting', 
    'comp'
]

# 表記ゆれマップ（良くある間違いや略称を推奨値にマッピング）
TASK_TYPE_SYNONYMS = {
    'デザイン': 'design',
    '設計': 'design',
    'ドキュメント': 'documentation',
    '文書': 'documentation',
    'マニュアル': 'documentation',
    'テスト': 'testing',
    '検証': 'testing',
    'レビュー': 'review',
    '校閲': 'review',
    'ミーティング': 'meeting',
    '会議': 'meeting',
    'mtg': 'meeting',
    'アセット': 'asset',
    '素材': 'asset',
    'アニメーション': 'animation',
    '動き': 'animation',
    'ライティング': 'lighting',
    '照明': 'lighting',
    'コンポ': 'comp',
    '合成': 'comp',
    'composition': 'comp',
    'vfx': 'fx',
    'エフェクト': 'fx',
}

def normalize_task_type(task_type: Optional[str]) -> Optional[str]:
    """
    タスクタイプを正規化する。
    1. 推奨値に完全一致（大文字小文字無視）すればその値を返す
    2. 表記ゆれマップに一致すれば推奨値を返す
    3. それ以外は、推奨値の中に含まれるキーワードがあればその推奨値を返す
    4. どれにも当てはまらなければ、元の値をそのまま返す（安全のため）
    """
    if not task_type:
        return task_type
        
    s = task_type.strip().lower()
    
    # 0. そのまま推奨値にあれば即座に返す
    if s in RECOMMENDED_TASK_TYPES:
        return s
        
    # 1. 表記ゆれマップ（完全一致）
    if s in TASK_TYPE_SYNONYMS:
        return TASK_TYPE_SYNONYMS[s]
        
    # 2. 部分一致やキーワードチェック
    for rec in RECOMMENDED_TASK_TYPES:
        # 推奨値が入力に含まれている、または入力が推奨値に含まれている場合
        # かなり短い語（fx, assetなど）への誤爆注意
        if len(s) >= 2 and (s in rec or rec in s):
            return rec
            
    # 3. 日本語キーワードの部分一致
    for syn, rec in TASK_TYPE_SYNONYMS.items():
        if len(s) >= 2 and (s in syn or syn in s):
            return rec
            
    # 4. どれにも当てはまらなければそのまま（安全に保存）
    return task_type
