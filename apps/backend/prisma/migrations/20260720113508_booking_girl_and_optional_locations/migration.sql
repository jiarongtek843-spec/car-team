/*
  Warnings:

  - You are about to drop the column `customer_email` on the `bookings` table. All the data in the column will be lost.
  - You are about to drop the column `customer_name` on the `bookings` table. All the data in the column will be lost.
  - You are about to drop the column `customer_phone` on the `bookings` table. All the data in the column will be lost.
  - Added the required column `girl_name` to the `bookings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "customer_email",
DROP COLUMN "customer_name",
DROP COLUMN "customer_phone",
ADD COLUMN     "car_fee" INTEGER,
ADD COLUMN     "girl_name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "legs" ALTER COLUMN "pickup_location" DROP NOT NULL,
ALTER COLUMN "dropoff_location" DROP NOT NULL;
