import sys
import uuid
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from main import app
from database import init_db
from playlists import init_playlist_tables

# Initialize tables
init_db()
init_playlist_tables()

client = TestClient(app)

def run_tests():
    print("=== STARTING IN-PROCESS HIERARCHICAL LIBRARY & AUTH TEST SUITE ===")

    # 1. Register Alice and Bob
    uid_a = str(uuid.uuid4())[:6]
    uid_b = str(uuid.uuid4())[:6]

    res_a = client.post("/api/auth/register", json={
        "email": f"alice_{uid_a}@test.com",
        "username": f"alice_{uid_a}",
        "password": "Password123!",
        "full_name": "Alice Tester"
    })
    assert res_a.status_code == 201, f"Alice register failed: {res_a.status_code} {res_a.text}"
    token_a = res_a.json()["access_token"]
    user_id_a = res_a.json()["user"]["id"]
    headers_a = {"Authorization": f"Bearer {token_a}"}
    print(f"[OK] Registered Alice (id={user_id_a})")

    res_b = client.post("/api/auth/register", json={
        "email": f"bob_{uid_b}@test.com",
        "username": f"bob_{uid_b}",
        "password": "Password123!",
        "full_name": "Bob Tester"
    })
    assert res_b.status_code == 201, f"Bob register failed: {res_b.status_code} {res_b.text}"
    token_b = res_b.json()["access_token"]
    user_id_b = res_b.json()["user"]["id"]
    headers_b = {"Authorization": f"Bearer {token_b}"}
    print(f"[OK] Registered Bob (id={user_id_b})")

    # 2. Test User Isolation: Folders & Items
    # Alice creates ALICE_HITS
    res = client.post("/api/playlists/folders", json={"path": "ALICE_HITS"}, headers=headers_a)
    assert res.status_code == 200, f"Alice create folder failed: {res.text}"

    # Alice adds song
    res = client.post("/api/playlists/items", json={
        "video_id": f"vid_alice_{uid_a}",
        "title": "Alice in Wonderland Anthem",
        "thumbnail": "https://img.yt.com/alice.jpg",
        "channel": "Alice Official",
        "duration": "3:15",
        "views": "1M views",
        "folder_path": "ALICE_HITS",
        "is_favorite": True
    }, headers=headers_a)
    assert res.status_code == 200, f"Alice add item failed: {res.text}"
    item_id_a = res.json()["id"]
    print(f"[OK] Alice added item {item_id_a}")

    # Bob creates BOB_TRACKS
    res = client.post("/api/playlists/folders", json={"path": "BOB_TRACKS"}, headers=headers_b)
    assert res.status_code == 200, f"Bob create folder failed: {res.text}"

    # Bob adds song
    res = client.post("/api/playlists/items", json={
        "video_id": f"vid_bob_{uid_b}",
        "title": "Bob Builder Jam",
        "thumbnail": "https://img.yt.com/bob.jpg",
        "channel": "Bob Records",
        "duration": "4:00",
        "views": "500K views",
        "folder_path": "BOB_TRACKS",
        "is_favorite": False
    }, headers=headers_b)
    assert res.status_code == 200, f"Bob add item failed: {res.text}"
    item_id_b = res.json()["id"]
    print(f"[OK] Bob added item {item_id_b}")

    # Verify Isolation in Trees
    tree_a = client.get("/api/playlists/tree", headers=headers_a).json()
    alice_folder_paths = [f["path"] for f in tree_a["folders"]]
    assert "ALICE_HITS" in alice_folder_paths, "ALICE_HITS should be in Alice tree"
    assert "BOB_TRACKS" not in alice_folder_paths, "BOB_TRACKS MUST NOT leak into Alice tree!"
    print("[OK] Tree isolation verified for Alice")

    tree_b = client.get("/api/playlists/tree", headers=headers_b).json()
    bob_folder_paths = [f["path"] for f in tree_b["folders"]]
    assert "BOB_TRACKS" in bob_folder_paths, "BOB_TRACKS should be in Bob tree"
    assert "ALICE_HITS" not in bob_folder_paths, "ALICE_HITS MUST NOT leak into Bob tree!"
    print("[OK] Tree isolation verified for Bob")

    # Verify Isolation in Videos
    contents_a = client.get("/api/playlists/folder?path=ALL", headers=headers_a).json()
    alice_vids = [v["video_id"] for v in contents_a["videos"]]
    assert f"vid_alice_{uid_a}" in alice_vids, "Alice should see her song"
    assert f"vid_bob_{uid_b}" not in alice_vids, "Bob song MUST NOT leak into Alice library!"
    print("[OK] Library ALL contents isolation verified for Alice")

    contents_b = client.get("/api/playlists/folder?path=ALL", headers=headers_b).json()
    bob_vids = [v["video_id"] for v in contents_b["videos"]]
    assert f"vid_bob_{uid_b}" in bob_vids, "Bob should see his song"
    assert f"vid_alice_{uid_a}" not in bob_vids, "Alice song MUST NOT leak into Bob library!"
    print("[OK] Library ALL contents isolation verified for Bob")

    # Verify Guest isolation (no token -> 401 Unauthorized)
    guest_res = client.get("/api/playlists/folder?path=ALL")
    assert guest_res.status_code == 401, f"Guest must receive 401 Unauthorized, got {guest_res.status_code}"
    print("[OK] Guest isolation verified (unauthenticated requests rejected with 401)")

    # 3. Test Single Song Record (No Duplicates in DB)
    res = client.post("/api/playlists/items", json={
        "video_id": f"vid_alice_{uid_a}",
        "title": "Alice in Wonderland Anthem (Remix)",
        "thumbnail": "https://img.yt.com/alice2.jpg",
        "channel": "Alice Official",
        "duration": "3:20",
        "views": "1.2M views",
        "folder_path": "ALICE_HITS/DANCE",
        "is_favorite": True
    }, headers=headers_a)
    assert res.status_code == 200, f"Re-adding song failed: {res.text}"
    updated_item_a = res.json()
    assert updated_item_a["id"] == item_id_a, "Song ID should remain same, not duplicated"

    alice_all = client.get("/api/playlists/folder?path=ALL", headers=headers_a).json()
    assert alice_all["total_videos"] == 1, f"Expected 1 unique song in Alice library, got {alice_all['total_videos']}"
    assert alice_all["videos"][0]["folder_path"] == "ALICE_HITS/DANCE", "Folder path updated"
    print("[OK] Single song record deduplication verified")

    # 4. Test System Views: FAVORITES and FAVORITE
    fav_view = client.get("/api/playlists/folder?path=FAVORITES", headers=headers_a).json()
    assert fav_view["total_videos"] == 1, "Alice should have 1 favorite"
    assert fav_view["subfolders"] == [], "Favorites view has no subfolders"

    fav_alias_view = client.get("/api/playlists/folder?path=FAVORITE", headers=headers_a).json()
    assert fav_alias_view["total_videos"] == 1, "FAVORITE alias works"

    bob_fav = client.get("/api/playlists/folder?path=FAVORITES", headers=headers_b).json()
    assert bob_fav["total_videos"] == 0, "Bob has 0 favorites"
    print("[OK] System FAVORITES & FAVORITE views verified")

    # 5. Test Deep Hierarchy & Recursive Song Aggregation
    # Alice builds: GENRE, GENRE/ROCK, GENRE/ROCK/INDIE
    client.post("/api/playlists/folders", json={"path": "GENRE/ROCK/INDIE"}, headers=headers_a)

    # Song 1 in GENRE
    client.post("/api/playlists/items", json={
        "video_id": f"genre_s1_{uid_a}",
        "title": "Root Genre Song",
        "thumbnail": "t1",
        "channel": "ch1",
        "folder_path": "GENRE"
    }, headers=headers_a)
    # Song 2 in GENRE/ROCK
    client.post("/api/playlists/items", json={
        "video_id": f"rock_s2_{uid_a}",
        "title": "Rock Genre Song",
        "thumbnail": "t2",
        "channel": "ch2",
        "folder_path": "GENRE/ROCK"
    }, headers=headers_a)
    # Song 3 in GENRE/ROCK/INDIE
    client.post("/api/playlists/items", json={
        "video_id": f"indie_s3_{uid_a}",
        "title": "Indie Rock Song",
        "thumbnail": "t3",
        "channel": "ch3",
        "folder_path": "GENRE/ROCK/INDIE"
    }, headers=headers_a)

    # In GENRE:
    # Subfolders: GENRE/ROCK (direct_count: 1, recursive_count: 2, song_count: 2)
    # Videos: 3 songs (genre_s1 + rock_s2 + indie_s3)
    genre_view = client.get("/api/playlists/folder?path=GENRE", headers=headers_a).json()
    assert genre_view["total_videos"] == 3, f"Expected 3 songs in GENRE subtree, got {genre_view['total_videos']}"
    assert len(genre_view["subfolders"]) == 1
    rock_sub = genre_view["subfolders"][0]
    assert rock_sub["path"] == "GENRE/ROCK"
    assert rock_sub["direct_count"] == 1
    assert rock_sub["recursive_count"] == 2
    assert rock_sub["song_count"] == 2
    print("[OK] GENRE recursive subtree aggregation & child counts verified")

    # In GENRE/ROCK:
    # Subfolders: GENRE/ROCK/INDIE (direct_count: 1, recursive_count: 1)
    # Videos: 2 songs (rock_s2 + indie_s3)
    rock_view = client.get("/api/playlists/folder?path=GENRE/ROCK", headers=headers_a).json()
    assert rock_view["total_videos"] == 2, f"Expected 2 songs in GENRE/ROCK subtree, got {rock_view['total_videos']}"
    assert len(rock_view["subfolders"]) == 1
    indie_sub = rock_view["subfolders"][0]
    assert indie_sub["path"] == "GENRE/ROCK/INDIE"
    assert indie_sub["direct_count"] == 1
    assert indie_sub["recursive_count"] == 1
    print("[OK] Progressive filtering down hierarchy verified")

    # In GENRE/ROCK/INDIE:
    # Subfolders: 0
    # Videos: 1 song (indie_s3)
    indie_view = client.get("/api/playlists/folder?path=GENRE/ROCK/INDIE", headers=headers_a).json()
    assert indie_view["total_videos"] == 1
    assert len(indie_view["subfolders"]) == 0
    print("[OK] Leaf folder contents verified")

    # 6. Test Folder Rename
    # Rename GENRE/ROCK to ALT_ROCK
    res = client.put("/api/playlists/folders/rename", json={
        "old_path": "GENRE/ROCK",
        "new_name": "ALT_ROCK"
    }, headers=headers_a)
    assert res.status_code == 200, f"Rename failed: {res.text}"
    assert res.json()["new_path"] == "GENRE/ALT_ROCK"

    # Verify child subfolder path updated to GENRE/ALT_ROCK/INDIE
    alt_view = client.get("/api/playlists/folder?path=GENRE/ALT_ROCK", headers=headers_a).json()
    assert len(alt_view["subfolders"]) == 1
    assert alt_view["subfolders"][0]["path"] == "GENRE/ALT_ROCK/INDIE"
    assert alt_view["total_videos"] == 2, "Songs updated to new folder prefix"
    print("[OK] Folder rename with child path updates verified")

    # Test rename safeguard against system views
    res = client.put("/api/playlists/folders/rename", json={
        "old_path": "ALL",
        "new_name": "NEW_ALL"
    }, headers=headers_a)
    assert res.status_code == 400, f"Expected 400 when renaming ALL, got {res.status_code}"
    print("[OK] Safeguard against renaming system views verified")

    # 7. Test Folder Move
    # Move GENRE/ALT_ROCK to ROOT
    res = client.put("/api/playlists/folders/move", json={
        "source_path": "GENRE/ALT_ROCK",
        "new_parent_path": ""
    }, headers=headers_a)
    assert res.status_code == 200, f"Move to root failed: {res.text}"
    assert res.json()["destination_path"] == "ALT_ROCK"

    # Verify ALT_ROCK is now a root folder and contains ALT_ROCK/INDIE
    root_alt = client.get("/api/playlists/folder?path=ALT_ROCK", headers=headers_a).json()
    assert root_alt["subfolders"][0]["path"] == "ALT_ROCK/INDIE"
    assert root_alt["total_videos"] == 2
    print("[OK] Folder move to new parent verified")

    # Test Circular Move Prevention
    res = client.put("/api/playlists/folders/move", json={
        "source_path": "ALT_ROCK",
        "new_parent_path": "ALT_ROCK/INDIE"
    }, headers=headers_a)
    assert res.status_code == 400, f"Expected 400 on circular move, got {res.status_code}"
    print("[OK] Circular move prevention verified")

    # 8. Test Song Move
    s_list = client.get("/api/playlists/folder?path=ALT_ROCK", headers=headers_a).json()
    song_to_move = s_list["videos"][0]
    res = client.put(f"/api/playlists/items/{song_to_move['id']}/move", json={
        "target_folder_path": "FAVORITE_COLLECTION"
    }, headers=headers_a)
    assert res.status_code == 200, f"Move song failed: {res.text}"
    assert res.json()["folder_path"] == "FAVORITE_COLLECTION"
    print("[OK] Song move between folders verified")

    # 9. Test Toggle Favorite
    fav_before = song_to_move["is_favorite"]
    res = client.post("/api/playlists/items/toggle-favorite", json={
        "item_id": song_to_move["id"]
    }, headers=headers_a)
    assert res.status_code == 200
    assert res.json()["is_favorite"] == (not fav_before)
    print("[OK] Toggle favorite verified")

    # 10. Test Safe Folder Deletion with delete_songs=False
    # Delete FAVORITE_COLLECTION, move songs to root/parent
    res = client.delete("/api/playlists/folders?path=FAVORITE_COLLECTION&delete_songs=false", headers=headers_a)
    assert res.status_code == 200, f"Safe delete folder failed: {res.text}"

    # Check that song was preserved in GENERAL
    gen_view = client.get("/api/playlists/folder?path=GENERAL", headers=headers_a).json()
    assert gen_view["total_videos"] >= 1, "Song was safely moved to GENERAL"
    print("[OK] Safe folder deletion (preserving songs) verified")

    # Test Safe Folder Deletion with delete_songs=True
    res = client.delete("/api/playlists/folders?path=GENERAL&delete_songs=true", headers=headers_a)
    assert res.status_code == 200
    print("[OK] Folder deletion with delete_songs=true verified")

    # Test Delete Safeguard on ALL / FAVORITES
    res = client.delete("/api/playlists/folders?path=ALL", headers=headers_a)
    assert res.status_code == 400, f"Expected 400 on deleting ALL, got {res.status_code}"
    res = client.delete("/api/playlists/folders?path=FAVORITES", headers=headers_a)
    assert res.status_code == 400, f"Expected 400 on deleting FAVORITES, got {res.status_code}"
    print("[OK] Safeguard against deleting ALL & FAVORITES verified")

    # 11. Test Item Removal & Isolation on Delete
    # Bob tries to delete Alice's song
    res = client.delete(f"/api/playlists/items/{item_id_a}", headers=headers_b)
    assert res.status_code == 404, f"Bob should get 404 trying to delete Alice's song, got {res.status_code}"
    print("[OK] Cross-user item deletion blocked")

    # Alice deletes her own song
    res = client.delete(f"/api/playlists/items/{item_id_a}", headers=headers_a)
    assert res.status_code == 200
    print("[OK] Item removal by owner verified")

    # Clean up test accounts and their items/folders so test never pollutes database
    from database import get_db
    conn = get_db()
    with conn:
        conn.execute("DELETE FROM playlist_items WHERE user_id IN (?, ?)", (user_id_a, user_id_b))
        conn.execute("DELETE FROM folders WHERE user_id IN (?, ?)", (user_id_a, user_id_b))
        conn.execute("DELETE FROM auth WHERE id IN (?, ?)", (user_id_a, user_id_b))
    conn.close()
    print("[OK] Test cleanup complete (database remains pristine)")

    print("\n🎉 ALL 11 TESTS PASSED PERFECTLY! FULL USER ISOLATION, SCHEMA, SYSTEM VIEWS, AND SAFE FOLDER/ITEM CRUD VERIFIED.")

if __name__ == "__main__":
    run_tests()
