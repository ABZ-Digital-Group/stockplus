StockPlus

StockPlus is a web-based inventory management and Point of Sale (POS) system built with Node.js and MongoDB. It streamlines stock control with features like bulk Excel imports, dynamically generated printable EAN barcodes, and a real-time dashboard that displays low-stock alerts. The integrated POS terminal ensures inventory is automatically updated with every sale, and automated email notifications help prevent stockouts.

✨ Features

Mobile-Friendly UI: A fully responsive design featuring a clean hamburger menu and touch-friendly interface for managing stock on the go.

Integrated Barcode Scanner: Use any smartphone or tablet camera to instantly scan barcodes directly into the system using the html5-qrcode library.

Smart Printable Labels: Automatically generates accurate EAN-13 and EAN-8 scannable barcodes for shelf-edges and products.

Bulk Importing: Import large amounts of stock data quickly via Excel spreadsheets.

Role-Based Access: Secure login system with distinct 'Admin' and 'Staff' permissions.

Low-Stock Alerts: Real-time dashboard warnings and automated email notifications when products fall below their designated threshold.

🛠️ Tech Stack

Backend: Node.js, Express.js

Database: MongoDB (Mongoose)

Frontend: EJS (Embedded JavaScript templates), HTML5, CSS3

Libraries: JsBarcode (Label generation), HTML5-QRCode (Camera scanning)

🚀 Installation & Setup

Clone the repository:

  git clone [https://github.com/ABZ-Digital-Group/stockplus.git](https://github.com/ABZ-Digital-Group/stockplus.git)


Navigate to the project directory:

  cd stockplus


Install the required dependencies:

  npm install


Set up your environment variables (e.g., MongoDB URI, Email credentials).

Start the application:

  npm start
