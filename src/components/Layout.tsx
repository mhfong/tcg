import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import LowPolyBackground from './LowPolyBackground'

export default function Layout() {
  return (
    <>
      <LowPolyBackground />
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
    </>
  )
}
