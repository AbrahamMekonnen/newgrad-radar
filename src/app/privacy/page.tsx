import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - HireRadar',
  description: 'How HireRadar collects, uses, and protects your information.',
};

export default function PrivacyPage() {
  const updated = 'September 15, 2026';
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-gray-800 dark:text-gray-200">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Privacy Policy</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Last updated: {updated}</p>

      <section className="mt-8 space-y-6 leading-relaxed">
        <p>
          HireRadar (&quot;we&quot;, &quot;us&quot;) helps people discover tech jobs across
          all experience levels and track their applications. This policy explains what we
          collect, how we use it, and the choices you have.
        </p>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Information we collect</h2>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>Account information.</strong> When you sign in with email or Google, we
              receive your email address and basic profile details (such as your name) from
              your chosen sign-in provider.
            </li>
            <li>
              <strong>Application activity.</strong> Jobs you save, track, or apply to, and
              preferences you set (filters, watchlist, notification settings).
            </li>
            <li>
              <strong>Resume content.</strong> If you upload a resume for match scoring or
              tailoring, we store the content you provide to power those features.
            </li>
            <li>
              <strong>Usage data.</strong> Basic, standard technical data (such as pages
              viewed) needed to operate and secure the service.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">How we use your information</h2>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>To provide and personalize the job-search, tracking, and prep features.</li>
            <li>To authenticate you and keep your account secure.</li>
            <li>To send notifications you have opted into.</li>
            <li>To improve the product and fix problems.</li>
          </ul>
          <p className="mt-2">We do not sell your personal information.</p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Google sign-in</h2>
          <p className="mt-2">
            When you sign in with Google, we request only your basic profile and email
            (the standard <code>email</code>, <code>profile</code>, and <code>openid</code>{' '}
            scopes). We do not access your Gmail, Drive, contacts, or any other Google data.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Service providers</h2>
          <p className="mt-2">
            We use trusted providers to run HireRadar, including Supabase (authentication and
            database) and our hosting provider. They process data only to provide these
            services to us.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Data retention & deletion</h2>
          <p className="mt-2">
            We keep your information while your account is active. You can request deletion of
            your account and associated data at any time by contacting us at the email below,
            and we will delete it unless we are required to retain it by law.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Your choices</h2>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Update your preferences and notifications in your account settings.</li>
            <li>Disconnect Google access from your Google Account&apos;s security settings.</li>
            <li>Request access to or deletion of your data via the contact email.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Contact</h2>
          <p className="mt-2">
            Questions about this policy or your data? Email{' '}
            <a href="mailto:amekonnen076@gmail.com" className="text-indigo-600 dark:text-indigo-400 underline">
              amekonnen076@gmail.com
            </a>
            .
          </p>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          We may update this policy from time to time; the &quot;Last updated&quot; date above
          reflects the latest revision.
        </p>
      </section>
    </main>
  );
}
