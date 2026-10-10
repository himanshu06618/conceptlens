import os
import sys
from pathlib import Path

# Add backend directory to path
backend_path = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from fastapi.testclient import TestClient
from main import app
from database import init_db

def test_full_auth_matrix():
    init_db()
    client = TestClient(app)

    # 1. Unauthenticated gets 401 on protected endpoint
    res_401 = client.get("/auth/teacher-only")
    assert res_401.status_code == 401, f"Expected 401, got {res_401.status_code}"
    print("PASS: Unauthenticated gets 401 on protected endpoint")

    # 2. Register as student
    student_payload = {
        "email": "test_student@example.com",
        "username": "test_student",
        "password": "Password123!",
        "confirm_password": "Password123!",
        "name": "Alice Student",
        "role": "student"
    }
    res_reg_student = client.post("/auth/register", json=student_payload)
    if res_reg_student.status_code == 400 and "already exists" in res_reg_student.text:
        # If already registered, login
        res_login_student = client.post("/auth/login", json={"email": "test_student@example.com", "password": "Password123!"})
        assert res_login_student.status_code == 200
        student_data = res_login_student.json()
    else:
        assert res_reg_student.status_code == 200, f"Register student failed: {res_reg_student.text}"
        student_data = res_reg_student.json()

    student_token = student_data.get("token") or student_data.get("access_token")
    assert student_token, "Student token missing"
    assert "password_hash" not in student_data.get("user", {})
    assert student_data.get("user", {}).get("role") == "student"
    print("PASS: Register and login as student")

    # 3. Register as teacher
    teacher_payload = {
        "email": "test_teacher@example.com",
        "username": "test_teacher",
        "password": "Password123!",
        "confirm_password": "Password123!",
        "name": "Prof. Bob",
        "role": "teacher"
    }
    res_reg_teacher = client.post("/auth/register", json=teacher_payload)
    if res_reg_teacher.status_code == 400 and "already exists" in res_reg_teacher.text:
        res_login_teacher = client.post("/auth/login", json={"email": "test_teacher@example.com", "password": "Password123!"})
        assert res_login_teacher.status_code == 200
        teacher_data = res_login_teacher.json()
    else:
        assert res_reg_teacher.status_code == 200, f"Register teacher failed: {res_reg_teacher.text}"
        teacher_data = res_reg_teacher.json()

    teacher_token = teacher_data.get("token") or teacher_data.get("access_token")
    assert teacher_token, "Teacher token missing"
    assert teacher_data.get("user", {}).get("role") == "teacher"
    print("PASS: Register and login as teacher")

    # 4. Student token gets 403 on teacher endpoints
    headers_student = {"Authorization": f"Bearer {student_token}"}
    res_student_teacher_endpoint = client.get("/auth/teacher-only", headers=headers_student)
    assert res_student_teacher_endpoint.status_code == 403, f"Expected 403 for student, got {res_student_teacher_endpoint.status_code}"

    res_student_dashboard = client.get("/teacher/dashboard", headers=headers_student)
    assert res_student_dashboard.status_code == 403, f"Expected 403 for student on /teacher/dashboard, got {res_student_dashboard.status_code}"
    print("PASS: Student token gets 403 on teacher endpoints")

    # 5. Teacher token gets 200 on teacher endpoints
    headers_teacher = {"Authorization": f"Bearer {teacher_token}"}
    res_teacher_endpoint = client.get("/auth/teacher-only", headers=headers_teacher)
    assert res_teacher_endpoint.status_code == 200, f"Expected 200 for teacher, got {res_teacher_endpoint.status_code}"

    res_teacher_dashboard = client.get("/teacher/dashboard", headers=headers_teacher)
    assert res_teacher_dashboard.status_code == 200, f"Expected 200 for teacher on /teacher/dashboard, got {res_teacher_dashboard.status_code}"
    print("PASS: Teacher token gets 200 on teacher endpoints")

    # 6. GET /auth/me returns current user
    res_me = client.get("/auth/me", headers=headers_student)
    assert res_me.status_code == 200
    me_data = res_me.json()
    assert me_data["email"] == "test_student@example.com"
    assert me_data["role"] == "student"
    assert "password_hash" not in me_data
    print("PASS: GET /auth/me returns current user")

    # 7. PATCH /auth/role is rejected if role is already set
    res_patch_set = client.patch("/auth/role", json={"role": "teacher"}, headers=headers_student)
    assert res_patch_set.status_code == 400, f"Expected 400 when changing existing role, got {res_patch_set.status_code}"
    print("PASS: PATCH /auth/role rejected when role already set")

    # 8. User with null role CAN set role with PATCH /auth/role
    from database import create_user
    import uuid
    new_google_uid = str(uuid.uuid4())
    create_user(
        user_id=new_google_uid,
        username=f"google_user_{new_google_uid[:8]}",
        email=f"google_{new_google_uid[:8]}@example.com",
        display_name="Google Newbie",
        role=None
    )
    from auth import create_access_token
    null_role_token = create_access_token(user_id=new_google_uid, username=f"google_user_{new_google_uid[:8]}")
    headers_null = {"Authorization": f"Bearer {null_role_token}"}

    res_patch_ok = client.patch("/auth/role", json={"role": "teacher"}, headers=headers_null)
    assert res_patch_ok.status_code == 200, f"Expected 200 setting null role, got {res_patch_ok.status_code}: {res_patch_ok.text}"
    assert res_patch_ok.json()["role"] == "teacher"
    print("PASS: PATCH /auth/role succeeds when role was null")

    # 9. Guest endpoints (health & public extraction) work without auth
    res_health = client.get("/health")
    assert res_health.status_code == 200
    print("PASS: Guest endpoints work without logging in")

if __name__ == "__main__":
    test_full_auth_matrix()
    print("\nALL BACKEND AUTH MATRIX TESTS PASSED SUCCESSFULLY!")
