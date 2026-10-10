from typing import List, Optional
from pydantic import BaseModel, Field

# Concept and Document Models
class RelatedConcept(BaseModel):
    name: str
    weight: int = 1
    type: str = "related"
    label: str = ""

class ConceptItem(BaseModel):
    id: int
    document_id: str
    name: str
    definition: str = ""
    topic: str = "General"
    score: float
    importance: int = Field(ge=1, le=5)
    source_excerpt: str = ""
    page: int = 1
    flow_order: int = 0
    flow_group: str = "General"
    related_concepts: List[RelatedConcept] = []

class DocumentItem(BaseModel):
    id: str
    filename: str
    file_type: str
    status: str
    stage: Optional[str] = "pending"
    progress: Optional[int] = 0
    stage_message: Optional[str] = ""
    ocr_current_page: Optional[int] = 0
    ocr_total_pages: Optional[int] = 0
    error: Optional[str] = None
    page_count: int = 1
    processing_time_sec: Optional[float] = 0.0
    provider_used: Optional[str] = "on-device"
    skipped_pages: Optional[str] = "[]"
    created_at: str
    concept_count: int = 0

class DocumentDetail(BaseModel):
    id: str
    filename: str
    file_type: str
    status: str
    stage: Optional[str] = "pending"
    progress: Optional[int] = 0
    stage_message: Optional[str] = ""
    ocr_current_page: Optional[int] = 0
    ocr_total_pages: Optional[int] = 0
    error: Optional[str] = None
    page_count: int = 1
    raw_text: Optional[str] = ""
    processing_time_sec: Optional[float] = 0.0
    provider_used: Optional[str] = "on-device"
    skipped_pages: Optional[str] = "[]"
    created_at: str
    concept_count: int = 0

class DocumentConceptsResponse(BaseModel):
    document_id: str
    total_concepts: int
    topics: List[str]
    concepts: List[ConceptItem]

class UploadResponse(BaseModel):
    id: str
    filename: str
    file_type: str
    status: str
    stage: str
    progress: Optional[int] = 0
    stage_message: Optional[str] = "Document uploaded successfully. Processing started."
    message: str

# User & Auth Models
class UserRegisterRequest(BaseModel):
    username: str
    password: str
    confirm_password: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[str] = "student"

class UserLoginRequest(BaseModel):
    username: str
    password: str

class GoogleAuthRequest(BaseModel):
    credential: str

class UserResponse(BaseModel):
    id: str
    username: str
    display_name: str
    email: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str = "student"
    has_password: bool
    created_at: str

class UpdateUserRequest(BaseModel):
    display_name: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: Optional[str] = None

class DeleteAccountRequest(BaseModel):
    confirm: bool = True

# Study Planner Models
class ChapterProgressUpdateRequest(BaseModel):
    status: int = Field(ge=0, le=2)

class ChapterMetaUpdateRequest(BaseModel):
    difficulty: Optional[int] = Field(default=None, ge=0, le=2)
    est_hours: Optional[float] = Field(default=None, ge=0.1)

class PlanPreviewRequest(BaseModel):
    subject_id: str
    days: int = Field(ge=7, le=30)
    order_mode: str = "syllabus"  # 'syllabus' | 'easy' | 'hard'
    scope_chapter_id: Optional[str] = None
    start_date: Optional[str] = None

class PlanCreateRequest(BaseModel):
    subject_id: str
    days: int = Field(ge=7, le=30)
    order_mode: str = "syllabus"
    scope_chapter_id: Optional[str] = None
    start_date: Optional[str] = None

class ReminderCreateRequest(BaseModel):
    time: str  # "HH:MM"
    weekdays: List[int] = [0, 1, 2, 3, 4, 5, 6]
    label: str = "Study Session"
    enabled: bool = True

class ReminderUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    time: Optional[str] = None
    weekdays: Optional[List[int]] = None
    label: Optional[str] = None

