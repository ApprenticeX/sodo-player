from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials

from logger import get_logger
from database import get_auth_backend
from security import (
    http_bearer,
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
)
from schemas import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
    MessageResponse,
)

logger = get_logger("sodo.auth")
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer),
    db=Depends(get_auth_backend),
) -> dict:
    """Retrieve and validate the authenticated user from Bearer token."""
    if not credentials:
        logger.debug("Authentication failed: Missing Bearer token header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(credentials.credentials)
    except Exception as e:
        logger.warning(f"Authentication token decode failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if not user_id:
        logger.warning("Token missing subject claim 'sub'")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.find_by_id(user_id)
    if not user:
        logger.warning(f"Authenticated user ID '{user_id}' no longer exists in database")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active", True):
        logger.warning(f"User ID '{user_id}' is deactivated or suspended")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is suspended or deactivated.",
        )

    return user


def get_optional_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer),
    db=Depends(get_auth_backend),
) -> Optional[dict]:
    """Retrieve and validate authenticated user if Bearer token is provided, or return None for guests."""
    if not credentials or not credentials.credentials:
        return None

    try:
        payload = decode_access_token(credentials.credentials)
        user_id = payload.get("sub")
        if not user_id:
            return None
        user = db.find_by_id(user_id)
        if not user or not user.get("is_active", True):
            return None
        return user
    except Exception:
        return None


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db=Depends(get_auth_backend)):
    """Authenticate with email or username and password, returning JWT access token."""
    login_id = payload.login_id.strip()
    logger.info(f"Authenticating login request for identifier: '{login_id}'")

    user = db.find_by_login(login_id)
    if not user or not verify_password(payload.password, user.get("hashed_password", "")):
        logger.warning(f"Failed authentication attempt for identifier: '{login_id}'")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active", True):
        logger.warning(f"Login denied for suspended account: '{user.get('username')}'")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is suspended or deactivated.",
        )

    token = create_access_token(
        subject=user["id"],
        extra_claims={"email": user["email"], "username": user["username"]},
    )

    logger.info(f"User '{user['username']}' (ID: {user['id']}) logged in successfully.")
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse(**user),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db=Depends(get_auth_backend)):
    """Register a new user account into auth table."""
    email = payload.email.strip().lower()
    username = payload.username.strip()

    logger.info(f"Registration request for username: '{username}', email: '{email}'")

    if db.find_by_email(email):
        logger.warning(f"Registration rejected: email already registered '{email}'")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists.",
        )

    if db.find_by_username(username):
        logger.warning(f"Registration rejected: username already taken '{username}'")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This username is already taken. Please choose another.",
        )

    new_user = db.create_user({
        "email": email,
        "username": username,
        "full_name": payload.full_name.strip() if payload.full_name else None,
        "hashed_password": hash_password(payload.password),
    })

    token = create_access_token(
        subject=new_user["id"],
        extra_claims={"email": email, "username": username},
    )

    logger.info(f"User account created successfully: '{username}' (ID: {new_user['id']})")
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse(**new_user),
    )


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    """Return the profile of the currently authenticated user."""
    return UserResponse(**current_user)


@router.post("/logout", response_model=MessageResponse)
def logout(current_user: dict = Depends(get_current_user)):
    """Stateless logout acknowledgment."""
    logger.info(f"User '{current_user.get('username')}' (ID: {current_user.get('id')}) logged out.")
    return MessageResponse(message="Successfully signed out.")
