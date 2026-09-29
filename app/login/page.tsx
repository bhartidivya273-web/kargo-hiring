export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <form action="/api/login" method="post" style={{ maxWidth: 320 }}>
      <h1>Sign in</h1>
      <input type="password" name="password" placeholder="Password" autoFocus required />
      {error && <p className="err">Wrong password.</p>}
      <p><button className="primary">Sign in</button></p>
    </form>
  );
}
