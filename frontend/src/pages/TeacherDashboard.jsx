import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, BookOpen, Users, BarChart3, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getDisplayName } from '../utils/userUtils';
import MyNotesCard from '../components/planner/MyNotesCard';
import '../styles/planner.css';

export default function TeacherDashboard() {
  const { user, isAuthenticated, loading: authLoading, openAuthModal } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      openAuthModal('signin', 'Sign in to access the Teacher Portal.');
      navigate('/');
    } else if (user && user.role === 'student') {
      navigate('/student/dashboard');
    }
  }, [isAuthenticated, authLoading, user, navigate, openAuthModal]);

  return (
    <div className="planner-container" style={{ maxWidth: '960px' }}>
      <section className="planner-header-section">
        <h1 className="planner-greeting">
          Teacher Portal
        </h1>
        <div className="planner-status-line">
          <span className="badge">Teacher Dashboard</span>
          <span>Welcome, Professor {getDisplayName(user, 'Instructor')}!</span>
        </div>
      </section>

      <div className="planner-section-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'var(--planner-mint-light)',
            color: 'var(--planner-mint)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px'
          }}
        >
          <GraduationCap size={36} />
        </div>

        <h2 style={{ fontFamily: 'var(--planner-font-title)', fontSize: '1.8rem', margin: '0 0 12px' }}>
          Instructor & Classroom Overview
        </h2>

        <p style={{ maxWidth: '580px', margin: '0 auto 32px', color: 'var(--planner-text-muted)', fontSize: '1.05rem', lineHeight: 1.5 }}>
          The teacher dashboard is configured as a dedicated space for classroom syllabus assignment, student cohort analytics, and curriculum pacing. Student study planning is active under the student dashboard.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: '640px', margin: '0 auto 36px' }}>
          <div style={{ padding: '16px', background: 'var(--planner-chip-bg)', borderRadius: 'var(--planner-radius-sm)', border: '1px solid var(--planner-card-border)' }}>
            <Users size={24} color="var(--planner-mint)" style={{ marginBottom: 8 }} />
            <div style={{ fontFamily: 'var(--planner-font-title)', fontWeight: 600 }}>Student Cohorts</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--planner-text-muted)', marginTop: 4 }}>Track class progression</div>
          </div>

          <div style={{ padding: '16px', background: 'var(--planner-chip-bg)', borderRadius: 'var(--planner-radius-sm)', border: '1px solid var(--planner-card-border)' }}>
            <BookOpen size={24} color="var(--planner-orange)" style={{ marginBottom: 8 }} />
            <div style={{ fontFamily: 'var(--planner-font-title)', fontWeight: 600 }}>Assigned Syllabi</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--planner-text-muted)', marginTop: 4 }}>Curate course chapters</div>
          </div>

          <div style={{ padding: '16px', background: 'var(--planner-chip-bg)', borderRadius: 'var(--planner-radius-sm)', border: '1px solid var(--planner-card-border)' }}>
            <BarChart3 size={24} color="var(--planner-mint)" style={{ marginBottom: 8 }} />
            <div style={{ fontFamily: 'var(--planner-font-title)', fontWeight: 600 }}>Pacing Insights</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--planner-text-muted)', marginTop: 4 }}>Detect topic bottlenecks</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/')}
          className="start-plan-btn"
          style={{ margin: '0 auto' }}
        >
          <ArrowLeft size={16} />
          <span>Return to Notes Workspace</span>
        </button>
      </div>

      <div style={{ marginTop: '24px' }}>
        <MyNotesCard />
      </div>
    </div>
  );
}
