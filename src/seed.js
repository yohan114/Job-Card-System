'use strict';

/** Seeds the database on first run with one demo user per role + master data. */

const db = require('./db');
const auth = require('./auth');
const { ROLES } = require('./domain');

function seed() {
  if (!db.isEmpty()) return;
  console.log('Seeding demo data...');

  const projects = [
    { id: 'prj_bdg', name: 'Badalgama Plant', code: 'BDG' },
    { id: 'prj_gir', name: 'Giriulla Plant', code: 'GIR' },
    { id: 'prj_ho', name: 'Head Office', code: 'HO' },
  ];

  const vehicles = [
    { id: 'veh_5041', regNo: 'LK-5041', type: 'Tipper Truck', projectId: 'prj_bdg', ecdNo: '1090', currentMeter: 80625 },
    { id: 'veh_2210', regNo: 'NP-2210', type: 'Excavator', projectId: 'prj_bdg', ecdNo: '1042', currentMeter: 13400 },
    { id: 'veh_7788', regNo: 'CAB-7788', type: 'Double Cab', projectId: 'prj_gir', ecdNo: '1077', currentMeter: 54210 },
  ];

  const vendors = [
    { id: 'ven_unitra', companyName: 'United Motors Lanka', email: 'service@unitedmotors.example', contactNo: '011-2393239', address: 'Colombo 02' },
    { id: 'ven_diesel', companyName: 'Diesel & Motor Engineering (DIMO)', email: 'workshop@dimo.example', contactNo: '011-2449797', address: 'Colombo 14' },
    { id: 'ven_local', companyName: 'Badalgama Auto Care', email: 'badalgamaauto@example.com', contactNo: '031-2269900', address: 'Giriulla Road, Badalgama' },
  ];

  const people = [
    { id: 'usr_admin', username: 'admin', name: 'System Administrator', designation: 'Administrator', email: 'admin@enc.example', roles: [ROLES.ADMIN] },
    { id: 'usr_to', username: 'tofficer', name: 'Chanuva Bandara', designation: 'Transport Officer', email: 'transport.officer@enc.example', roles: [ROLES.TRANSPORT_OFFICER] },
    { id: 'usr_tm', username: 'tmanager', name: 'Ruwan Silva', designation: 'Transport Manager', email: 'transport.manager@enc.example', roles: [ROLES.TRANSPORT_MANAGER] },
    { id: 'usr_ame', username: 'ame', name: 'Kasun Perera', designation: 'Assistant Mechanical Engineer', email: 'asst.engineer@enc.example', roles: [ROLES.ASST_MECH_ENGINEER] },
    { id: 'usr_me', username: 'me', name: 'Nuwan Fernando', designation: 'Mechanical Engineer', email: 'mech.engineer@enc.example', roles: [ROLES.MECH_ENGINEER] },
    { id: 'usr_om', username: 'omanager', name: 'A. N. Amarasekara', designation: 'Operational Manager', email: 'ops.manager@enc.example', roles: [ROLES.OPERATIONAL_MANAGER] },
    { id: 'usr_tech', username: 'tech', name: 'Sunil Jayaweera', designation: 'Workshop Technician', email: 'workshop@enc.example', roles: [ROLES.TECHNICIAN] },
  ];

  projects.forEach((p) => db.insert('projects', p));
  vehicles.forEach((v) => db.insert('vehicles', v));
  vendors.forEach((v) => db.insert('vendors', v));
  people.forEach((p) => {
    db.insert('users', { ...p, password: auth.hashPassword('password'), active: true, createdAt: new Date().toISOString() });
  });

  console.log('Seed complete. All demo accounts use the password: "password".');
}

module.exports = { seed };
