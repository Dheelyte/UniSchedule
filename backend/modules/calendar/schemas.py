from pydantic import BaseModel, ConfigDict

class SessionCreate(BaseModel):
    name: str

class SessionResponse(SessionCreate):
    id: int
    is_current: bool
    model_config = ConfigDict(from_attributes=True)

class SemesterCreate(BaseModel):
    name: str
    session_id: int

class SemesterResponse(SemesterCreate):
    id: int
    is_current: bool
    model_config = ConfigDict(from_attributes=True)
