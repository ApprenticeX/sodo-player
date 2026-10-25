from typing import Optional
from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """Credentials for logging in (accepts email or username)."""
    login_id: str = Field(..., description="Email address or username", min_length=3)
    password: str = Field(..., description="Account password", min_length=1)


class RegisterRequest(BaseModel):
    """Payload for registering a new user."""
    email: EmailStr = Field(..., description="Valid user email address")
    username: str = Field(..., min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(..., min_length=6, max_length=128)
    full_name: Optional[str] = Field(default=None, max_length=80)


class UserResponse(BaseModel):
    """Public user profile information."""
    id: str
    email: str
    username: str
    full_name: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    """Authentication token response payload."""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class MessageResponse(BaseModel):
    """Standard message response."""
    message: str
