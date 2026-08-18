import localFont from 'next/font/local';
import './globals.css';

// Afacad ships only in Regular; the 400-700 range lets
// bold headings resolve to this face with renderer-synthesized bold, the same approach the
// deck theme takes. Body text stays Arial; Afacad is display-only.
const afacad = localFont({
  src: './fonts/Afacad-Regular.ttf',
  weight: '400 700',
  variable: '--font-afacad',
  display: 'swap',
});

export const metadata = {
  title: 'Meridian',
  description: 'Meridian training application',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={afacad.variable}>
      <body>{children}</body>
    </html>
  );
}
