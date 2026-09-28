/** Shared section layout for the Org module (frontend mock, Phase 1). */
export default function OrgModuleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="p-4 sm:p-8 max-w-6xl mx-auto">{children}</div>
    </div>
  );
}
