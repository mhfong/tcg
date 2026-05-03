import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import LowPolyBackground from './LowPolyBackground'

export default function Layout() {
  return (
    <>
      <LowPolyBackground />
      <Sidebar />
      <main style={{
        flex: 1, padding: '2rem', overflowY: 'auto',
        position: 'relative', zIndex: 10,
        background: 'rgba(245,237,227,0.6)',
      }}>
        <Outlet />
      </main>
    </>
  )
}
