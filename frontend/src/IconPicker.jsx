import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

/* Curated Material Icons for smart-home / dashboard use */
const ICONS = [
  // Home & Rooms
  'home','home_work','cottage','villa','apartment','door_front','garage','deck','yard','grass','balcony',
  // Devices & Network
  'router','wifi','lan','hub','device_hub','network_check','dns','cloud','cloud_sync','storage',
  'computer','laptop','phone_android','tablet','tv','monitor','smart_display','speaker','headphones',
  // Smart Home
  'thermostat','ac_unit','light_mode','brightness_7','bolt','electrical_services','power','power_settings_new',
  'sensors','settings_remote','smart_toy','videocam','camera','visibility','doorbell',
  'lock','lock_open','water_drop','local_fire_department','heat','hvac','blinds','curtains',
  // Security
  'security','shield','vpn_lock','key','fingerprint','verified_user','admin_panel_settings',
  // Dev / Server
  'terminal','code','developer_mode','integration_instructions','bug_report','memory','developer_board',
  'settings_ethernet',
  // Media
  'music_note','volume_up','mic','radio','podcasts','movie','live_tv',
  // Analytics / Monitoring
  'bar_chart','analytics','monitoring','show_chart','pie_chart','speed','trending_up',
  // Navigation / UI
  'dashboard','apps','grid_view','explore','menu','widgets','view_module',
  // Files & Cloud
  'folder','folder_open','cloud_upload','cloud_download','backup','inventory','database',
  // Links & Web
  'link','open_in_new','web','language','public','share',
  // Notifications / Time
  'notifications','alarm','schedule','calendar_today','event','timer',
  // People & Auth
  'person','group','account_circle','badge','manage_accounts',
  // Sync / Transfer
  'download','upload','sync','refresh','autorenew','swap_horiz',
  // Maps & Location
  'location_on','map','gps_fixed','near_me',
  // Misc Utility
  'settings','tune','build','construction','star','favorite','bookmark','label','tag',
  'directions_car','local_grocery_store','shopping_cart','email','chat','forum',
];

const isMaterialIcon = (v) => v && /^[a-z][a-z_0-9]+$/.test(v) && ICONS.includes(v);

export { ICONS, isMaterialIcon };

export default function IconPicker({ value, onChange }) {
  const [open,    setOpen]    = useState(false);
  const [search,  setSearch]  = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });

  const triggerRef = useRef(null);
  const dropRef    = useRef(null);

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        dropRef.current    && !dropRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const openDropdown = () => {
    const rect = triggerRef.current.getBoundingClientRect();
    // Flip upward if not enough room below
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropH      = 320; // approx dropdown height
    const top = spaceBelow >= dropH
      ? rect.bottom + 4
      : rect.top - dropH - 4;
    setDropPos({ top, left: rect.left });
    setOpen(o => !o);
  };

  const filtered = search.trim()
    ? ICONS.filter(i => i.includes(search.trim().toLowerCase().replace(/\s+/g, '_')))
    : ICONS;

  const select = (icon) => { onChange(icon); setOpen(false); setSearch(''); };
  const clear  = (e)    => { e.stopPropagation(); onChange(''); };

  const hasValue = isMaterialIcon(value);

  const dropdown = open && createPortal(
    <div
      ref={dropRef}
      className="ip-dropdown"
      style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
    >
      <div className="ip-search-wrap">
        <span className="material-icons ip-search-icon">search</span>
        <input
          className="ip-search"
          type="text"
          placeholder="Search icons…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="ip-grid">
        {filtered.map(icon => (
          <button
            key={icon}
            type="button"
            className={`ip-cell${value === icon ? ' ip-selected' : ''}`}
            onClick={() => select(icon)}
            title={icon.replace(/_/g, ' ')}
          >
            <span className="material-icons">{icon}</span>
            <span className="ip-label">{icon.replace(/_/g, ' ')}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <span className="ip-empty-msg">No icons found</span>
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <div className="ip-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`ip-trigger${open ? ' ip-open' : ''}`}
        onClick={openDropdown}
        title="Choose icon"
      >
        {hasValue
          ? <span className="material-icons ip-preview">{value}</span>
          : <span className="material-icons ip-preview ip-placeholder">star</span>}
        {hasValue && (
          <span className="ip-clear" onClick={clear} title="Clear">✕</span>
        )}
      </button>
      {dropdown}
    </div>
  );
}
