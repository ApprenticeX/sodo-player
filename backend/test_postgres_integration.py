"""
Comprehensive verification test for Neon PostgreSQL integration, Auth, Library, and User Data Export API.
"""

import sys
import uuid
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from main import app
from database import init_db, get_db

init_db()
client = TestClient(app)

def run_integration_tests():
    print("=== STARTING POSTGRESQL INTEGRATION TEST SUITE ===")

    # 1. Register a test user
    test_suffix = str(uuid.uuid4())[:6]
    username = f"pguser_{test_suffix}"
    email = f"pguser_{test_suffix}@example.com"
    password = "StrongPassword123!"

    print(f"\n1. Registering test user: {username} ({email})...")
    res = client.post("/api/auth/register", json={
        "username": username,
        "email": email,
        "password": password,
        "full_name": "Postgres Test User",
    })
    assert res.status_code == 201, f"Register failed: {res.status_code} {res.text}"
    data = res.json()
    token = data["access_token"]
    user_id = data["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}
    print(f"   [OK] Registered user ID: {user_id}")

    # 2. Test /api/auth/me
    print("\n2. Testing /api/auth/me...")
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 200
    me = res.json()
    assert me["username"] == username
    assert me["email"] == email
    print(f"   [OK] /api/auth/me returned correct profile")

    # 3. Test Login
    print("\n3. Testing /api/auth/login with username...")
    res = client.post("/api/auth/login", json={
        "login_id": username,
        "password": password,
    })
    assert res.status_code == 200
    assert "access_token" in res.json()
    print("   [OK] Login succeeded")

    # 4. Test Library Folders & Songs in PostgreSQL
    print("\n4. Testing Folder Creation in PostgreSQL...")
    res = client.post("/api/playlists/folders", json={"path": "ROCK/INDIE"}, headers=headers)
    assert res.status_code == 200, f"Folder creation failed: {res.text}"
    print("   [OK] Created folder ROCK/INDIE")

    print("\n5. Testing Playlist Item Addition in PostgreSQL...")
    test_vid = f"vid_{test_suffix}"
    res = client.post("/api/playlists/items", json={
        "video_id": test_vid,
        "title": "Arctic Monkeys - Do I Wanna Know?",
        "thumbnail": "https://img.yt.com/am.jpg",
        "channel": "Arctic Monkeys",
        "duration": "4:32",
        "views": "1.5B views",
        "folder_path": "ROCK/INDIE",
        "is_favorite": True,
    }, headers=headers)
    assert res.status_code == 200, f"Add item failed: {res.text}"
    item_id = res.json()["id"]
    print(f"   [OK] Added track (item_id={item_id})")

    # 6. Test User Data Export API: GET /api/user/data
    print("\n6. Testing User Data Export API: GET /api/user/data...")
    res = client.get("/api/user/data", headers=headers)
    assert res.status_code == 200, f"Export failed: {res.status_code} {res.text}"
    export_data = res.json()

    assert export_data["version"] == "1.0.0"
    assert export_data["system"] == "sodo-player"
    assert export_data["user"]["id"] == user_id
    assert export_data["user"]["username"] == username
    assert export_data["stats"]["total_folders"] >= 2  # ROCK, ROCK/INDIE
    assert export_data["stats"]["total_songs"] == 1
    assert export_data["stats"]["total_favorites"] == 1
    assert len(export_data["playlist_items"]) == 1
    assert export_data["playlist_items"][0]["video_id"] == test_vid
    assert export_data["playlist_items"][0]["is_favorite"] is True
    print(f"   [OK] Export JSON verified: {export_data['stats']}")

    # 7. Test Export Download Option
    print("\n7. Testing User Data Export Download: GET /api/user/data/export?download=true...")
    res = client.get("/api/user/data/export?download=true", headers=headers)
    assert res.status_code == 200
    assert "attachment" in res.headers.get("content-disposition", "")
    print(f"   [OK] Download response header: {res.headers.get('content-disposition')}")

    # 8. Clean up test account and its data from PostgreSQL
    print("\n8. Cleaning up test user and library from PostgreSQL...")
    conn = get_db()
    with conn:
        conn.execute("DELETE FROM playlist_items WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM folders WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id::text = ?", (user_id,))
    conn.close()
    print("   [OK] Cleanup complete - PostgreSQL database remains pristine.")

    print("\n" + "=" * 55)
    print("🎉 ALL POSTGRESQL & USER DATA EXPORT TESTS PASSED!")
    print("=" * 55 + "\n")


if __name__ == "__main__":
    run_integration_tests()
