/** Shared section layout for the Org module: full-width, single column on phones. */
export default function OrgModuleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="p-4 sm:p-8 w-full">{children}</div>
    </div>
  );
}
