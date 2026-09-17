import { redirect } from 'next/navigation';

export default function AutoApplyRedirect() {
  redirect('/applications?section=autoapply');
}
