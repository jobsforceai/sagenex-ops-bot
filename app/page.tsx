import { isAuthed } from '../lib/auth';
import LoginPage from './login';
import ChatShell from './chat';

export default async function Home() {
  const authed = await isAuthed();
  return authed ? <ChatShell /> : <LoginPage />;
}
