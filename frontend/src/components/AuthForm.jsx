import React from 'react';
import AuthModal from './AuthModal';

/**
 * AuthForm component legacy wrapper.
 * The application has unified authentication into the centered <AuthModal /> popup.
 */
export default function AuthForm(props) {
  return <AuthModal {...props} />;
}
