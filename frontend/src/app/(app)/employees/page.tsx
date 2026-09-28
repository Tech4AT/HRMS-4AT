import { redirect } from 'next/navigation';

/**
 * The standalone All Employees screen was merged into the Employee
 * Directory tab of the Organisation section, which now has a
 * List/Gallery view toggle. Old links land on the combined screen.
 */
export default function EmployeesRedirect() {
  redirect('/org?tab=directory');
}
