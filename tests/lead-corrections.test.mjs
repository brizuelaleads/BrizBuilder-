import assert from 'node:assert/strict';
import test from 'node:test';
import { linkAppointmentRows, leadCorrectionPatch, manualProvenance, projectLeadAppointment, latestLinkedAppointment, appointmentTimePatch } from '../lib/lead-corrections.ts';
import { shouldApplyTranscriptField } from '../lib/callrail-enrichment.ts';

test('manual edits allow clearing optional fields and never change tenant or record identity', () => {
  const patch = leadCorrectionPatch({ firstName:' Alex ', lastName:'', phone:'9034402757', email:' A@EXAMPLE.COM ', address:'', campaign:'', assignedUser:'', message:'', leadScore:'65', organizationId:'other', contactId:'other', clientId:'other' });
  assert.deepEqual(patch.contact,{first_name:'Alex',last_name:'',phone:'9034402757',email:'a@example.com',address:null});
  assert.deepEqual(patch.lead,{message:'',campaign:null,assigned_user:null,lead_score:65});
  assert.deepEqual(leadCorrectionPatch({}),{contact:{},lead:{}});
});
test('invalid corrections are rejected before storage writes', () => {
  for(const input of [{firstName:''},{email:'wrong'},{phone:'12'},{leadScore:101},{leadScore:2.5},{consentStatus:'invented'},{estimatedValueCents:-1},{finalRevenueCents:Infinity},{source:''}]) assert.throws(()=>leadCorrectionPatch(input));
});
test('manual provenance protects corrections, including intentional blanks, from transcript enrichment', () => {
  const metadata=manualProvenance({city:{source:'transcript'}},['phone','message']);
  assert.equal(metadata.city.source,'transcript');
  for (const existing of ['',null,'old']) assert.equal(shouldApplyTranscriptField(existing,{value:'new',confidence:1,explicitCorrection:true},metadata.phone,.9,true),false);
});
const lead={id:'l1',clientId:'c1',appointmentStatus:'confirmed',appointmentStart:'old'};
const row={id:'a1',lead_id:'l1',client_id:'c1',starts_at:'2026-10-01T15:00:00Z',ends_at:'2026-10-01T16:00:00Z',status:'CONFIRMED'};
test('lead reflects calendar confirmation, rescheduling, cancellation and deletion',()=>{
  for(const status of ['SCHEDULED','CONFIRMED','COMPLETED','CANCELED','NO_SHOW']) {
    const result=projectLeadAppointment(lead,[{...row,status}]); assert.equal(result.appointmentStatus,status.toLowerCase()); assert.equal(result.appointmentStart,row.starts_at);
  }
  assert.equal(projectLeadAppointment(lead,[{...row,starts_at:'2026-10-02T15:00:00Z'}]).appointmentStart,'2026-10-02T15:00:00Z');
  assert.equal(projectLeadAppointment(lead,[]).appointmentStatus,'none'); assert.equal(projectLeadAppointment(lead,[]).appointmentStart,null);
});
test('other clients and other leads cannot supply appointment state',()=>{
  assert.equal(projectLeadAppointment(lead,[{...row,client_id:'c2'},{...row,lead_id:'l2'}]).appointmentStart,null);
  assert.equal(latestLinkedAppointment(lead,[{id:'a',clientId:'c2',leadId:'l1',startsAt:row.starts_at}]),null);
});
test('appointment time validation rejects invalid or reversed times and preserves valid instants',()=>{
  const existing={startsAt:row.starts_at,endsAt:row.ends_at};
  assert.throws(()=>appointmentTimePatch({startsAt:'bad'},existing));assert.throws(()=>appointmentTimePatch({endsAt:'2026-10-01T14:00:00Z'},existing));
  assert.equal(appointmentTimePatch({startsAt:'2026-10-01T10:00:00-05:00'},existing).starts_at,'2026-10-01T15:00:00.000Z');
});

test('contact-only appointments resolve consistently without guessing between leads',()=>{
  const legacy={...row,lead_id:null,contact_id:'contact'};
  const leads=[{id:'l1',clientId:'c1',contactId:'contact'}];
  assert.equal(linkAppointmentRows([legacy],leads)[0].lead_id,'l1');
  assert.equal(linkAppointmentRows([legacy],[...leads,{...leads[0],id:'l2'}])[0].lead_id,null);
  assert.equal(linkAppointmentRows([legacy],[{...leads[0],clientId:'c2'}])[0].lead_id,null);
  assert.equal(linkAppointmentRows([{...legacy,lead_id:'explicit'}],leads)[0].lead_id,'explicit');
});
