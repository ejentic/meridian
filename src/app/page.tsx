import { redirect } from 'next/navigation';

/**
 * There is no landing page. Products is the first screen every role can use, so it is where
 * both the root and a completed sign-in land.
 */
export default function Home() {
  redirect('/products');
}
