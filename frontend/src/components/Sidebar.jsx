import {
  Bot,
  ChartColumn,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";

function Sidebar({
  activePage,
  setActivePage,
  collapsed,
  setCollapsed,
  currentUser,
  onLogout,
}) {
  const menuItems = [
    { name: "Upload", icon: <Upload size={20} /> },
    { name: "Dashboard", icon: <LayoutDashboard size={20} /> },
    { name: "Data Quality", icon: <ShieldCheck size={20} /> },
    { name: "Data Visualization", icon: <ChartColumn size={20} /> },
    { name: "Chatbot", icon: <Bot size={20} /> },
  ];

  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="logo-icon">AI</div>

          <div className="sidebar-brand-text">
            <h2>Data Insight</h2>
            <p>Assistant</p>
          </div>
        </div>

        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((previous) => !previous)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
      </div>

      {!collapsed && <p className="sidebar-section-label">Workspace</p>}

      <nav className="sidebar-menu">
        {menuItems.map((item) => (
          <button
            key={item.name}
            type="button"
            className={
              activePage === item.name
                ? "sidebar-item active"
                : "sidebar-item"
            }
            onClick={() => setActivePage(item.name)}
            title={collapsed ? item.name : undefined}
          >
            <span className="sidebar-item-icon">{item.icon}</span>
            <span className="sidebar-label">{item.name}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-account">
        <span className="sidebar-account-icon">
          <UserRound size={17} />
        </span>

        <div className="sidebar-account-copy">
          <strong>{currentUser?.username || "User"}</strong>
          <span>Signed in</span>
        </div>

        <button
          type="button"
          className="sidebar-logout"
          onClick={onLogout}
          aria-label="Log out"
          title="Log out"
        >
          <LogOut size={17} />
        </button>
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-status-dot" />
        <div className="sidebar-bottom-text">
          <strong>Analysis workspace</strong>
          <span>Ready when your data is</span>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
