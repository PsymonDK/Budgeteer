import { BrowserRouter, Routes, Route } from 'react-router-dom'

function Home() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-amber-400 mb-2">
          ☠️ Personal Budgeteer
        </h1>
        <p className="text-gray-400">Your treasure map to financial freedom</p>
      </div>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App