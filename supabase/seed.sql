-- Standard compliance title library. ILLUSTRATIVE ONLY: legal basis and frequencies depend on the premises,
-- equipment, legislation and risk assessment, and MUST be reviewed by a competent professional before clients rely on them.
insert into category_library (grp, title, default_basis, default_frequency_months) values
 ('Fire safety','Fire risk assessment','legal',12),
 ('Fire safety','Fire alarm servicing and testing','standard',6),
 ('Fire safety','Emergency lighting inspection and function test','standard',12),
 ('Fire safety','Fire extinguisher servicing','standard',12),
 ('Fire safety','Fire door inspection','standard',6),
 ('Fire safety','Fire blankets and other equipment','best_practice',12),
 ('Electrical','Electrical installation condition report (EICR)','standard',60),
 ('Electrical','Portable appliance testing (PAT)','best_practice',12),
 ('Electrical','Electrical remedial works follow-up','standard',null),
 ('Water hygiene','Legionella risk assessment','legal',24),
 ('Water hygiene','Water temperature monitoring','standard',1),
 ('Water hygiene','Little-used outlet flushing','standard',1),
 ('Building and services','Asbestos survey / management record','legal',12),
 ('Building and services','Gas safety inspection','legal',12),
 ('Building and services','Air conditioning servicing / F-Gas','standard',12),
 ('Building and services','Heating, ventilation and mechanical servicing','best_practice',12),
 ('Building and services','Pest control','best_practice',3),
 ('Building and services','Roof and drainage inspection','best_practice',12),
 ('Building and services','Window cleaning / scheduled services','best_practice',null)
on conflict (grp, title) do nothing;
