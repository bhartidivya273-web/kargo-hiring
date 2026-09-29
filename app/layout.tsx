import "./globals.css";

export const metadata = { title: "Kargo Hiring" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <b>Kargo Hiring</b>
          <a href="/">Dashboard</a>
          <a href="/upload">Upload CVs</a>
          <a href="/rubric">Rubric</a>
          <form action="/api/logout" method="post">
            <button className="small">Sign out</button>
          </form>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
