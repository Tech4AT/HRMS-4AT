'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { EyeIcon, EyeOffIcon } from '@/components/icons';

/**
 * A password field with a show/hide button. Drop-in for
 * `<input type="password" …>`: every other input prop passes through, and the
 * caller's `className` styles the input itself (right padding is added so text
 * never runs under the button).
 */
export function PasswordInput({
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Hide password' : 'Show password';

  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className={`${className} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:text-indigo-600"
      >
        {visible ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
      </button>
    </div>
  );
}
