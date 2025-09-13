# Nexus Mail - Smart Email Client for Individual Business Owners

A smart email client designed specifically for individual business owners that integrates purchase history management, important email identification, and calendar integration.

## 🌟 Features

### 📧 Smart Email Management
- **Auto-classification** of emails requiring replies
- **Priority scoring** based on sender importance and content urgency
- **Smart categorization** (Work, Personal, Purchases, Notifications)

### 💰 Purchase Management System
- **Automatic receipt/invoice organization**
- **Expense tracking** with monthly reports
- **Category-based spending analysis**
- **Receipt storage** in Google Drive

### 📅 Calendar Integration
- **Smart scheduling** with available time slot suggestions
- **Meeting request detection** from emails
- **Multi-calendar support** for comprehensive availability checking

### 🔐 Multi-Account Support
- **Multiple Google account management**
- **Unified inbox view**
- **Account-specific settings**

## 🚀 Technology Stack

### Frontend
- **React 18** with TypeScript
- **Tailwind CSS** for styling
- **React Router** for navigation
- **React Query** for data fetching
- **Recharts** for data visualization

### Backend
- **Node.js** with Express
- **TypeScript** for type safety
- **PostgreSQL** for data persistence
- **Redis** for caching
- **Google APIs** (Gmail, Calendar, Drive)

### Authentication
- **Google OAuth 2.0**
- **JWT** for session management
- **Passport.js** for authentication strategies

## 📋 Prerequisites

- Node.js v18 or higher
- PostgreSQL 15
- Redis 7
- Google Cloud Platform account with:
  - Gmail API enabled
  - Google Calendar API enabled
  - Google Drive API enabled
  - OAuth 2.0 credentials configured

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone https://github.com/your-username/nexus-mail.git
cd nexus-mail
```

### 2. Set up environment variables
```bash
cp .env.example .env
```
Edit `.env` with your configuration:
- Google OAuth credentials
- Database connection strings
- JWT secrets

### 3. Start the database services
```bash
docker-compose up -d
```

### 4. Install dependencies
```bash
npm install
```

### 5. Run database migrations
```bash
npm run db:migrate
```

### 6. Start the development servers
```bash
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- PGAdmin: http://localhost:5050

## 📁 Project Structure

```
nexus-mail/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/        # Page components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── utils/        # Utility functions
│   │   └── api/          # API client functions
│   └── package.json
├── server/                # Express backend
│   ├── src/
│   │   ├── routes/       # API routes
│   │   ├── controllers/  # Route controllers
│   │   ├── services/     # Business logic
│   │   ├── models/       # Database models
│   │   ├── middleware/   # Express middleware
│   │   └── config/       # Configuration files
│   └── package.json
├── shared/               # Shared types and utilities
│   └── types/
├── database/            # Database migrations and seeds
│   ├── migrations/
│   └── seeds/
├── docker-compose.yml   # Docker configuration
└── README.md
```

## 🔒 Security Features

- **Token encryption** for secure storage
- **HTTPS enforced** in production
- **CSRF protection**
- **Rate limiting** on API endpoints
- **Input validation** and sanitization
- **SQL injection prevention** with parameterized queries

## 📊 Database Schema

### Core Tables
- `users` - User accounts
- `google_accounts` - Connected Google accounts
- `purchases` - Purchase history and receipts
- `email_classifications` - Email categorization data
- `schedule_suggestions` - Calendar availability suggestions

## 🧪 Testing

```bash
# Run all tests
npm test

# Run frontend tests
npm run test:client

# Run backend tests
npm run test:server
```

## 📦 Building for Production

```bash
# Build all packages
npm run build

# Build frontend only
npm run build:client

# Build backend only
npm run build:server
```

## 🚀 Deployment

### Using Docker
```bash
docker build -t nexus-mail .
docker run -p 3000:3000 -p 3001:3001 nexus-mail
```

### Manual Deployment
1. Build the project: `npm run build`
2. Set production environment variables
3. Start the server: `npm start`

## 📝 API Documentation

### Authentication
- `POST /api/auth/google/login` - Initiate Google OAuth
- `POST /api/auth/google/callback` - OAuth callback
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/accounts` - List connected accounts

### Email Operations
- `GET /api/emails` - Fetch emails with filters
- `GET /api/emails/:id` - Get email details
- `POST /api/emails/send` - Send email
- `PATCH /api/emails/:id/classify` - Update email classification

### Purchase Management
- `GET /api/purchases` - Get purchase history
- `GET /api/purchases/stats` - Purchase statistics
- `POST /api/purchases/receipts/download` - Download receipts

### Calendar
- `GET /api/calendar/availability` - Get available time slots
- `POST /api/calendar/suggest-times` - Suggest meeting times
- `POST /api/calendar/create-event` - Create calendar event

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Google APIs for Gmail, Calendar, and Drive integration
- React and Node.js communities
- All contributors and testers

## 📞 Support

For support, email support@nexusmail.com or open an issue on GitHub.

---

**Note**: This is a development version. For production use, ensure all security measures are properly configured and tested.