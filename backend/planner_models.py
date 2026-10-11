import enum
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    Boolean,
    Text,
    ForeignKey,
    DateTime,
    CheckConstraint,
    UniqueConstraint
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class UserRole(str, enum.Enum):
    STUDENT = "student"
    TEACHER = "teacher"

class RelationType(str, enum.Enum):
    PREREQUISITE = "prerequisite"
    RELATED = "related"

class OrderMode(str, enum.Enum):
    SYLLABUS = "syllabus"
    EASY = "easy"
    HARD = "hard"

class User(Base):
    __tablename__ = "users"

    id = Column(String, PRIMARY_KEY=True) if hasattr(Base, "PRIMARY_KEY") else Column(String, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)
    google_sub = Column(String, unique=True, nullable=True)
    avatar_url = Column(String, nullable=True)
    role = Column(String, nullable=False, default="student")
    created_at = Column(String, nullable=False)
    last_login_at = Column(String, nullable=False)

    subjects = relationship("Subject", back_populates="user", cascade="all, delete-orphan")
    plans = relationship("StudyPlan", back_populates="user", cascade="all, delete-orphan")
    reminders = relationship("Reminder", back_populates="user", cascade="all, delete-orphan")
    progress = relationship("ChapterProgress", back_populates="user", cascade="all, delete-orphan")
    notes = relationship("Note", back_populates="user", cascade="all, delete-orphan")

class Subject(Base):
    __tablename__ = "subjects"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    code = Column(String, default="")
    created_at = Column(String, nullable=False)

    user = relationship("User", back_populates="subjects")
    books = relationship("Document", back_populates="subject")
    plans = relationship("StudyPlan", back_populates="subject", cascade="all, delete-orphan")

class Document(Base):
    """Reuse existing documents table as books."""
    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=True)
    subject_id = Column(String, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    filename = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    status = Column(String, nullable=False)
    stage = Column(String, default="pending")
    error = Column(String, nullable=True)
    page_count = Column(Integer, default=1)
    raw_text = Column(Text, nullable=True)
    tree_json = Column(Text, nullable=True)
    flow_json = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)

    subject = relationship("Subject", back_populates="books")
    chapters = relationship("Chapter", back_populates="book", cascade="all, delete-orphan")

class Chapter(Base):
    __tablename__ = "chapters"

    id = Column(String, primary_key=True)
    book_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    concept_count = Column(Integer, nullable=False, default=0)
    difficulty = Column(Integer, nullable=False, default=1)  # 0: easy, 1: medium, 2: hard
    est_hours = Column(Float, nullable=False, default=1.0)
    created_at = Column(String, nullable=False)

    book = relationship("Document", back_populates="chapters")
    topics = relationship("Topic", back_populates="chapter", cascade="all, delete-orphan", order_by="Topic.order_index")
    progress = relationship("ChapterProgress", back_populates="chapter", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("difficulty IN (0, 1, 2)", name="check_chapter_difficulty"),
    )

class Topic(Base):
    __tablename__ = "topics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    chapter_id = Column(String, ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    name = Column(String, nullable=False)
    cluster_id = Column(String, nullable=True)
    cluster_name = Column(String, nullable=True)

    chapter = relationship("Chapter", back_populates="topics")

class TopicRelation(Base):
    __tablename__ = "topic_relations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_topic_id = Column(Integer, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False)
    to_topic_id = Column(Integer, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)  # 'prerequisite' or 'related'

    __table_args__ = (
        CheckConstraint("type IN ('prerequisite', 'related')", name="check_relation_type"),
        CheckConstraint("from_topic_id != to_topic_id", name="check_no_self_links"),
        UniqueConstraint("from_topic_id", "to_topic_id", "type", name="unique_topic_relation"),
    )

class ChapterProgress(Base):
    __tablename__ = "chapter_progress"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    chapter_id = Column(String, ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False)
    status = Column(Integer, nullable=False, default=0)  # 0: not started, 1: in progress, 2: done
    updated_at = Column(String, nullable=False)

    user = relationship("User", back_populates="progress")
    chapter = relationship("Chapter", back_populates="progress")

    __table_args__ = (
        CheckConstraint("status IN (0, 1, 2)", name="check_chapter_progress_status"),
        UniqueConstraint("user_id", "chapter_id", name="unique_user_chapter_progress"),
    )

class StudyPlan(Base):
    __tablename__ = "study_plans"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(String, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    scope_chapter_id = Column(String, ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True)
    days = Column(Integer, nullable=False)  # 7 | 15 | 30
    order_mode = Column(String, nullable=False, default="syllabus")  # 'syllabus' | 'easy' | 'hard'
    start_date = Column(String, nullable=False)
    route_json = Column(Text, nullable=False)
    done_days = Column(Text, nullable=False, default="[]")
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    user = relationship("User", back_populates="plans")
    subject = relationship("Subject", back_populates="plans")

    __table_args__ = (
        CheckConstraint("days IN (7, 15, 30)", name="check_plan_days"),
        CheckConstraint("order_mode IN ('syllabus', 'easy', 'hard')", name="check_plan_order_mode"),
    )

class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    time = Column(String, nullable=False)  # "HH:MM"
    weekdays = Column(Text, nullable=False, default="[0,1,2,3,4,5,6]")  # JSON list of ints 0..6
    label = Column(String, nullable=False, default="Study Session")
    enabled = Column(Integer, nullable=False, default=1)
    created_at = Column(String, nullable=False)

    user = relationship("User", back_populates="reminders")

class Note(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(150), nullable=False, default="")
    content = Column(Text, nullable=False, default="")
    tags = Column(Text, nullable=False, default="[]")  # JSON array of short strings
    color = Column(String, nullable=True, default="")
    pinned = Column(Boolean, nullable=False, default=False, index=True)
    document_id = Column(String, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    chapter = Column(String, nullable=True, default="")
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False, index=True)

    user = relationship("User", back_populates="notes")
