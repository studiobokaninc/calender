import sys
print(sys.path)
try:
    import google
    print("google path:", google.__path__)
except ImportError:
    print("Could not import google")

try:
    from google import genai
    print("Successfully imported genai")
except ImportError as e:
    print("Error importing genai:", e)

try:
    import google.genai
    print("Successfully imported google.genai")
except ImportError as e:
    print("Error importing google.genai:", e)
