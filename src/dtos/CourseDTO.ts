// src/dtos/CourseDTO.ts
export interface CourseDTO {
  sno: string; // Student number
  diclNo: string; // Course number
  timtSmryCn: string; // Schedule summary
  estbDpmjNm: string; // Department offering the course
  subjtNm: string; // Subject name
  refacYearSmr: string; // Retake semester info
  closeYn: boolean; // Closed/finished status
  facDvcd: number; // Faculty division code
  point: number | null; // Credits for the course
  ltrPrfsNm: string; // Professor name
  subjtEstbYearSmr: string; // Subject establishment semester (e.g., "2024-2학기")
  subjtEstbSmrCd: string; // Semester code (e.g., "10", "20", "15", "25")
  facDvnm: string; // Faculty division name
  subjtCd: string; // Subject code
  subjtEstbYear: number; // Year subject was established
}
