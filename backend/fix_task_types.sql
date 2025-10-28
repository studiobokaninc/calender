-- 無効なタスクtypeを修正するSQLスクリプト

-- 1. 無効なtype値を持つタスクを表示
SELECT 'Before fix - Invalid types:' as message;
SELECT id, name, type, seqID, shotID 
FROM tasks 
WHERE type IS NOT NULL 
  AND LOWER(type) NOT IN ('development', 'design', 'documentation', 'testing', 'review', 'meeting', 'fx', 'asset', 'animation', 'lighting', 'comp');

-- 2. 無効なtype値をNULLに設定
UPDATE tasks 
SET type = NULL 
WHERE type IS NOT NULL 
  AND LOWER(type) NOT IN ('development', 'design', 'documentation', 'testing', 'review', 'meeting', 'fx', 'asset', 'animation', 'lighting', 'comp');

-- 3. 修正後の確認
SELECT 'After fix - Remaining invalid types (should be empty):' as message;
SELECT id, name, type, seqID, shotID 
FROM tasks 
WHERE type IS NOT NULL 
  AND LOWER(type) NOT IN ('development', 'design', 'documentation', 'testing', 'review', 'meeting', 'fx', 'asset', 'animation', 'lighting', 'comp');

