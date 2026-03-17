import asyncio
import os

async def test_ffprobe():
    # Use a dummy path or a real one if you have it
    abs_path = r"e:\calender\static\audio\test.m4a"
    # Create an empty file for testing if it doesn't exist
    if not os.path.exists(abs_path):
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "wb") as f:
            f.write(b"dummy")
    
    cmd = f'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "{abs_path}"'
    print(f"Running: {cmd}")
    process = await asyncio.create_subprocess_shell(
        cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    print(f"Return code: {process.returncode}")
    print(f"Stdout: {stdout.decode().strip()}")
    print(f"Stderr: {stderr.decode().strip()}")

if __name__ == "__main__":
    asyncio.run(test_ffprobe())
