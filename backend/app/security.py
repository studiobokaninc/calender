from passlib.context import CryptContext

# main.py から pwd_context の定義を移動
pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")

# パスワードハッシュ化関数を追加
def get_password_hash(password: str) -> str:
    """パスワードをハッシュ化する"""
    return pwd_context.hash(password)

# パスワード検証関数もこちらに移動すると良い
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """平文パスワードとハッシュ化パスワードを比較"""
    print("--- Verifying Password --- ") # デバッグログ追加
    print(f"Plain password received: '{plain_password[:3]}...' (length: {len(plain_password)}) ") # パスワード自体は表示しない
    print(f"Hashed password from DB: '{hashed_password[:15]}...' ") # ハッシュの先頭だけ表示
    try:
        result = pwd_context.verify(plain_password, hashed_password)
        print(f"Verification result: {result}") # 検証結果 (True/False) を表示
        print("-------------------------")
        return result
    except Exception as e:
        print(f"!!! Error during password verification: {e} !!!") # 検証中のエラーも捕捉
        import traceback
        traceback.print_exc()
        print("-------------------------")
        return False # エラー時は False を返す

# TODO: 必要であれば、トークン関連の関数 (create_access_token, get_current_user など) も
#       main.py からこちらに移動することを検討 