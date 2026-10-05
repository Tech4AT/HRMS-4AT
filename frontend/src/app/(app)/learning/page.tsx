'use client';

import { LearningOverview } from '@/components/learning/LearningOverview';

export default function LearningPage() {
  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="p-4 sm:p-8 max-w-6xl">
        <LearningOverview employeeId="me" showLaunch />
      </div>
    </div>
  );
}
