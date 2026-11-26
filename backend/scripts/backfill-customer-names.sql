BEGIN;
UPDATE "Customer" SET "realName" = name WHERE "realName" IS NULL;
UPDATE "Order" AS o SET "signedCustomerName" = c.name
FROM "Customer" AS c WHERE o."customerId" = c.id AND o."signedCustomerName" IS NULL;
COMMIT;
