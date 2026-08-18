-- 0026_bar_products_seed.sql
-- Seed the bar product list (current club price list, Aug 2026). Idempotent: only runs
-- if bar_products is empty, so it's safe to apply to Dev then Prod. Prices are PENCE.
-- Category mapping: beer = Beers/Lagers/Ciders, wine = Wines, spirit = Spirits,
-- zero_gf = Non-alcoholic & Gluten Free, soft = Mixers/Soft + Cordials/Splashes, snack.
--
-- Drop + recreate below: found Dev with every product duplicated 2x — db-restore.ts
-- resets the target schema (reapplying this seed) before pg_restore layers Prod's own
-- copy of bar_products on top. config/petrol_bands are seeded the same way but have
-- natural-key primary keys, so their restore duplicates collide and get silently
-- rejected (documented in db-restore.ts as an expected, harmless conflict). This table's
-- primary key is a random uuid, so the restore's copy never collided — it just landed
-- as 65 extra rows. No bar_sale_items reference any of the duplicates (bar isn't live
-- yet), so a clean drop/recreate is safe. The new unique(name, category) constraint
-- fixes the restore going forward too, the same way it already works for the other two
-- tables — a second insert now collides for real instead of silently succeeding.
-- Temporary fix — this whole Dev/Prod dance goes away once the Postgres cutover lands.

drop table if exists bar_products cascade;

create table bar_products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null,            -- 'beer','wine','zero_gf','soft','snack'
  price_pence int  not null check (price_pence >= 0),
  active      boolean not null default true,
  sort_order  int  not null default 0,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (name, category)
);
alter table bar_products enable row level security;

alter table bar_sale_items
  add constraint bar_sale_items_product_id_fkey foreign key (product_id) references bar_products(id);

do $$
begin
  if not exists (select 1 from bar_products) then
    insert into bar_products (name, category, price_pence, sort_order) values
      -- Beers, Lagers & Ciders
      ('Bishops Finger',            'beer', 260, 10),
      ('Doom Bar',                  'beer', 260, 20),
      ('Fursty Ferret',             'beer', 260, 30),
      ('Guinness',                  'beer', 200, 40),
      ('IPA',                       'beer', 260, 50),
      ('London Pride',              'beer', 260, 60),
      ('Newcastle Brown',           'beer', 260, 70),
      ('Speckled Hen',              'beer', 260, 80),
      ('Spitfire',                  'beer', 260, 90),
      ('1664 (single)',             'beer', 150, 100),
      ('1664 (2 bottles)',          'beer', 280, 110),
      ('Asahi',                     'beer', 360, 120),
      ('Budweiser',                 'beer', 160, 130),
      ('Fosters',                   'beer', 200, 140),
      ('Peroni',                    'beer', 200, 150),
      ('Lager Shandy',              'beer', 150, 160),
      ('Bulmers Original & Red',    'beer', 260, 170),
      ('Stowford',                  'beer', 200, 180),

      -- Non-alcoholic & Gluten Free
      ('Becks Blue',                'zero_gf', 140, 10),
      ('Heineken 0%',               'zero_gf', 140, 20),
      ('Kopparberg N/A',            'zero_gf', 260, 30),
      ('Guinness 0% 583ml',         'zero_gf', 280, 40),
      ('Guinness 0% 440ml',         'zero_gf', 200, 50),

      -- Wines
      ('Red/White/Rosé 187ml',      'wine', 260, 10),
      ('JP Chenet Rosé 250ml',      'wine', 290, 20),
      ('Prosecco',                  'wine', 400, 30),
      ('Barefoot Rosé (bottle)',    'wine', 900, 40),

      -- Spirits
      ('Club Double Whisky 50ml',   'spirit', 230, 10),
      ('Club Double Vodka 50ml',    'spirit', 230, 20),
      ('Club Double Brandy 50ml',   'spirit', 230, 30),
      ('Club Double White Rum 50ml','spirit', 230, 40),
      ('Jameson/Grouse 25ml',       'spirit', 170, 50),
      ('Bells 25ml',                'spirit', 170, 60),
      ('Jack Daniels 25ml',         'spirit', 170, 70),
      ('Southern Comfort 25ml',     'spirit', 170, 80),
      ('Bacardi White Rum 25ml',    'spirit', 170, 90),
      ('Lambs Navy Rum 25ml',       'spirit', 170, 100),
      ('Gordon''s Gin 25ml',        'spirit', 170, 110),
      ('Bombay Sapphire 25ml',      'spirit', 170, 120),
      ('Pink Gin 25ml',             'spirit', 170, 130),
      ('Courvoisier Brandy 25ml',   'spirit', 170, 140),
      ('Smirnoff Vodka 25ml',       'spirit', 170, 150),
      ('Morgan''s Spiced Rum 25ml', 'spirit', 170, 160),
      ('Noilly Prat 50ml',          'spirit', 170, 170),
      ('Baileys 50ml',              'spirit', 230, 180),
      ('Tia Maria/Cointreau 50ml',  'spirit', 230, 190),
      ('Ginger Wine 50ml',          'spirit', 170, 200),
      ('Martini Rosso 50ml',        'spirit', 170, 210),
      ('Martini Dry 50ml',          'spirit', 170, 220),

      -- Mixers, Soft Drinks & Splashes
      ('Tonic Water',               'soft', 100, 10),
      ('Coke/Diet Coke',            'soft', 100, 20),
      ('Ginger Beer',               'soft', 100, 30),
      ('Lemonade 330ml',            'soft', 100, 40),
      ('Lemonade small',            'soft',  60, 50),
      ('J2O & Appletizer',          'soft', 160, 60),
      ('Orange',                    'soft', 100, 70),
      ('Soda Water',                'soft',  60, 80),
      ('Water',                     'soft',  50, 90),
      ('Splash — Orange/Lime/Blackcurrant', 'soft', 30, 100),

      -- Snacks
      ('McCoys',                    'snack', 60, 10),
      ('Mini Cheddars',             'snack', 60, 20),
      ('Crisps',                    'snack', 50, 30),
      ('Quavers 45g',               'snack', 60, 40),
      ('Peanuts',                   'snack', 50, 50),
      ('Cashews',                   'snack', 80, 60);
  end if;
end $$;
